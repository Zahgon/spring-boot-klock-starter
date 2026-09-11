/**
 * `RedissonFairLock` — a reentrant lock that additionally hands the lock to
 * waiters in arrival order.
 *
 * The ordering is kept server-side in two companion keys, named as Redisson
 * names them so that every key of one lock lands in the same cluster slot:
 * `redisson_lock_queue:{<name>}` is the FIFO of waiting holders and
 * `redisson_lock_timeout:{<name>}` scores each waiter with the moment it may be
 * evicted, so a waiter that dies cannot block the queue for ever.
 */

import { RedissonBaseLock } from './redisson-lock.js';

/** Redisson's `threadWaitTime`: how long a queued waiter stays valid. */
const THREAD_WAIT_TIME_MS = 5_000;

const TRY_FAIR_LOCK_SCRIPT = `
while true do
  local head = redis.call('lindex', KEYS[2], 0);
  if head == false then break; end;
  local score = tonumber(redis.call('zscore', KEYS[3], head));
  if score == nil or score <= tonumber(ARGV[3]) then
    redis.call('zrem', KEYS[3], head);
    redis.call('lpop', KEYS[2]);
  else
    break;
  end;
end;

local head = redis.call('lindex', KEYS[2], 0);
if (redis.call('exists', KEYS[1]) == 0) and ((head == false) or (head == ARGV[2])) then
  if head ~= false then
    redis.call('lpop', KEYS[2]);
  end;
  redis.call('zrem', KEYS[3], ARGV[2]);
  redis.call('hincrby', KEYS[1], ARGV[2], 1);
  redis.call('pexpire', KEYS[1], ARGV[1]);
  return nil;
end;

if redis.call('hexists', KEYS[1], ARGV[2]) == 1 then
  redis.call('hincrby', KEYS[1], ARGV[2], 1);
  redis.call('pexpire', KEYS[1], ARGV[1]);
  return nil;
end;

if redis.call('zscore', KEYS[3], ARGV[2]) == false then
  redis.call('rpush', KEYS[2], ARGV[2]);
  redis.call('zadd', KEYS[3], tonumber(ARGV[3]) + tonumber(ARGV[4]), ARGV[2]);
end;

local ttl = redis.call('pttl', KEYS[1]);
if ttl < 0 then ttl = 0; end;
return ttl;`;

export class RedissonFairLock extends RedissonBaseLock {
  private get threadsQueueName(): string {
    return `redisson_lock_queue:{${this.name}}`;
  }

  private get timeoutSetName(): string {
    return `redisson_lock_timeout:{${this.name}}`;
  }

  protected override heldField(threadId: number): string {
    return this.getLockName(threadId);
  }

  protected override async tryLockInner(
    leaseMillis: number,
    threadId: number,
  ): Promise<number | null> {
    const result = await this.redis.eval(
      TRY_FAIR_LOCK_SCRIPT,
      3,
      this.name,
      this.threadsQueueName,
      this.timeoutSetName,
      String(leaseMillis),
      this.getLockName(threadId),
      String(Date.now()),
      String(THREAD_WAIT_TIME_MS),
    );
    return result === null ? null : Number(result);
  }
}
