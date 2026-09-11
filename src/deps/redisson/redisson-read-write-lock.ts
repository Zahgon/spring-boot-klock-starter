/**
 * `RedissonReadWriteLock` — one name carrying a shared read lock and an
 * exclusive write lock.
 *
 * Both share a single hash. Its `mode` field says which kind of lock is held
 * (`read` or `write`); a writer's hold is counted under
 * `<clientId>:<threadId>:write` and a reader's under `<clientId>:<threadId>`.
 * Each individual read hold also writes a companion
 * `{<name>}:<clientId>:<threadId>:rwlock_timeout:<n>` key so an abandoned reader
 * expires on its own. Releases are announced on
 * `redisson_rwlock__channel:{<name>}`.
 */

import type { RedisConnection } from './redis-connection.js';
import type { LockPubSub } from './lock-pub-sub.js';
import type { RLock } from './redisson-lock.js';
import { RedissonBaseLock } from './redisson-lock.js';

export interface RReadWriteLock {
  readLock(): RLock;
  writeLock(): RLock;
}

const TRY_READ_LOCK_SCRIPT = `
local mode = redis.call('hget', KEYS[1], 'mode');
if (mode == false) then
  redis.call('hset', KEYS[1], 'mode', 'read');
  redis.call('hset', KEYS[1], ARGV[2], 1);
  redis.call('set', KEYS[2] .. ':1', 1);
  redis.call('pexpire', KEYS[2] .. ':1', ARGV[1]);
  redis.call('pexpire', KEYS[1], ARGV[1]);
  return nil;
end;
if (mode == 'read') or (mode == 'write' and redis.call('hexists', KEYS[1], ARGV[3]) == 1) then
  local ind = redis.call('hincrby', KEYS[1], ARGV[2], 1);
  local key = KEYS[2] .. ':' .. ind;
  redis.call('set', key, 1);
  redis.call('pexpire', key, ARGV[1]);
  local remainTime = redis.call('pttl', KEYS[1]);
  redis.call('pexpire', KEYS[1], math.max(remainTime, tonumber(ARGV[1])));
  return nil;
end;
return redis.call('pttl', KEYS[1]);`;

const TRY_WRITE_LOCK_SCRIPT = `
local mode = redis.call('hget', KEYS[1], 'mode');
if (mode == false) then
  redis.call('hset', KEYS[1], 'mode', 'write');
  redis.call('hset', KEYS[1], ARGV[2], 1);
  redis.call('pexpire', KEYS[1], ARGV[1]);
  return nil;
end;
if (mode == 'write') and (redis.call('hexists', KEYS[1], ARGV[2]) == 1) then
  redis.call('hincrby', KEYS[1], ARGV[2], 1);
  local currentExpire = redis.call('pttl', KEYS[1]);
  redis.call('pexpire', KEYS[1], currentExpire + tonumber(ARGV[1]));
  return nil;
end;
return redis.call('pttl', KEYS[1]);`;

abstract class RedissonReadWriteLockPart extends RedissonBaseLock {
  protected override getChannelName(): string {
    return `redisson_rwlock__channel:{${this.name}}`;
  }

  /** Prefix of the per-hold expiry keys a reader creates. */
  protected timeoutPrefix(threadId: number): string {
    return `{${this.name}}:${this.getLockName(threadId)}:rwlock_timeout`;
  }

  protected writeField(threadId: number): string {
    return `${this.getLockName(threadId)}:write`;
  }
}

export class RedissonReadLock extends RedissonReadWriteLockPart {
  protected override heldField(threadId: number): string {
    return this.getLockName(threadId);
  }

  protected override async tryLockInner(
    leaseMillis: number,
    threadId: number,
  ): Promise<number | null> {
    const result = await this.redis.eval(
      TRY_READ_LOCK_SCRIPT,
      2,
      this.name,
      this.timeoutPrefix(threadId),
      String(leaseMillis),
      this.getLockName(threadId),
      this.writeField(threadId),
    );
    return result === null ? null : Number(result);
  }
}

export class RedissonWriteLock extends RedissonReadWriteLockPart {
  protected override heldField(threadId: number): string {
    return this.writeField(threadId);
  }

  protected override async tryLockInner(
    leaseMillis: number,
    threadId: number,
  ): Promise<number | null> {
    const result = await this.redis.eval(
      TRY_WRITE_LOCK_SCRIPT,
      1,
      this.name,
      String(leaseMillis),
      this.writeField(threadId),
    );
    return result === null ? null : Number(result);
  }
}

export class RedissonReadWriteLock implements RReadWriteLock {
  private readonly read: RedissonReadLock;
  private readonly write: RedissonWriteLock;

  constructor(redis: RedisConnection, pubSub: LockPubSub, name: string, clientId: string) {
    this.read = new RedissonReadLock(redis, pubSub, name, clientId);
    this.write = new RedissonWriteLock(redis, pubSub, name, clientId);
  }

  readLock(): RLock {
    return this.read;
  }

  writeLock(): RLock {
    return this.write;
  }
}
