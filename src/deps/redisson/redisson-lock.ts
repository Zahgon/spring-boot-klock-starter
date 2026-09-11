/**
 * `RedissonLock` — the reentrant lock the starter uses by default.
 *
 * The encoding below is the interoperability surface described in
 * `instruction.md` R2, and was read off a live Redis while the original ran:
 * the lock is a hash whose field is `<clientId>:<threadId>` and whose value is
 * the reentrant hold count, the key carries the lease as a millisecond TTL, and
 * releasing publishes `0` on `redisson_lock__channel:{<key>}`.
 */

import { Thread } from '../thread.js';
import type { RedisConnection } from './redis-connection.js';
import type { LockPubSub } from './lock-pub-sub.js';
import { UNLOCK_MESSAGE } from './lock-pub-sub.js';

/** Redisson's `lockWatchdogTimeout` default. */
export const LOCK_WATCHDOG_TIMEOUT_MS = 30_000;

export interface TimeUnitLike {
  toMillis(value: number): number;
}

export interface RLock {
  /** `tryLock(waitTime, leaseTime, unit)` — `leaseTime <= 0` engages the watchdog. */
  tryLock(waitTime: number, leaseTime: number, unit: TimeUnitLike): Promise<boolean>;
  /** `forceUnlockAsync().get()` — deletes the key whatever the hold count is. */
  forceUnlock(): Promise<boolean>;
  isHeldByCurrentThread(): Promise<boolean>;
  getName(): string;
}

const TRY_LOCK_SCRIPT = `
if ((redis.call('exists', KEYS[1]) == 0)
    or (redis.call('hexists', KEYS[1], ARGV[2]) == 1)) then
  redis.call('hincrby', KEYS[1], ARGV[2], 1);
  redis.call('pexpire', KEYS[1], ARGV[1]);
  return nil;
end;
return redis.call('pttl', KEYS[1]);`;

const FORCE_UNLOCK_SCRIPT = `
if (redis.call('del', KEYS[1]) == 1) then
  redis.call('publish', KEYS[2], ARGV[1]);
  return 1;
else
  return 0;
end;`;

const RENEW_SCRIPT = `
if (redis.call('hexists', KEYS[1], ARGV[2]) == 1) then
  redis.call('pexpire', KEYS[1], ARGV[1]);
  return 1;
end;
return 0;`;

/**
 * Shared machinery for every Redisson lock flavour: the wait/subscribe/retry
 * loop, the watchdog, and force-unlock.
 */
export abstract class RedissonBaseLock implements RLock {
  private internalLockLeaseTime = LOCK_WATCHDOG_TIMEOUT_MS;
  private readonly renewals = new Map<number, NodeJS.Timeout>();

  constructor(
    protected readonly redis: RedisConnection,
    protected readonly pubSub: LockPubSub,
    protected readonly name: string,
    protected readonly clientId: string,
  ) {}

  getName(): string {
    return this.name;
  }

  /** The hash field identifying the current holder. */
  protected getLockName(threadId: number): string {
    return `${this.clientId}:${threadId}`;
  }

  /** The channel a release is announced on. */
  protected getChannelName(): string {
    return `redisson_lock__channel:{${this.name}}`;
  }

  /** Acquire attempt: `null` means acquired, a number is the holder's remaining TTL. */
  protected abstract tryLockInner(leaseMillis: number, threadId: number): Promise<number | null>;

  /** The hash field whose presence means "held by this thread". */
  protected abstract heldField(threadId: number): string;

  async isHeldByCurrentThread(): Promise<boolean> {
    const threadId = Thread.currentThread().getId();
    const held = await this.redis.hexists(this.name, this.heldField(threadId));
    return held === 1;
  }

  async forceUnlock(): Promise<boolean> {
    this.cancelExpirationRenewal(Thread.currentThread().getId());
    const result = await this.redis.eval(
      FORCE_UNLOCK_SCRIPT,
      2,
      this.name,
      this.getChannelName(),
      UNLOCK_MESSAGE,
    );
    return result === 1;
  }

  async tryLock(waitTime: number, leaseTime: number, unit: TimeUnitLike): Promise<boolean> {
    const threadId = Thread.currentThread().getId();
    let time = unit.toMillis(waitTime);
    let current = Date.now();

    let ttl = await this.tryAcquire(leaseTime, unit, threadId);
    if (ttl === null) {
      return true;
    }

    time -= Date.now() - current;
    if (time <= 0) {
      return false;
    }

    current = Date.now();
    const channel = this.getChannelName();
    const entry = await this.pubSub.subscribe(channel);
    time -= Date.now() - current;
    if (time <= 0) {
      await this.pubSub.unsubscribe(channel);
      return false;
    }

    try {
      for (;;) {
        current = Date.now();
        ttl = await this.tryAcquire(leaseTime, unit, threadId);
        if (ttl === null) {
          return true;
        }
        time -= Date.now() - current;
        if (time <= 0) {
          return false;
        }

        current = Date.now();
        await entry.await(ttl >= 0 && ttl < time ? ttl : time);
        time -= Date.now() - current;
        if (time <= 0) {
          return false;
        }
      }
    } finally {
      await this.pubSub.unsubscribe(channel);
    }
  }

  private async tryAcquire(
    leaseTime: number,
    unit: TimeUnitLike,
    threadId: number,
  ): Promise<number | null> {
    if (leaseTime > 0) {
      this.internalLockLeaseTime = unit.toMillis(leaseTime);
      return await this.tryLockInner(this.internalLockLeaseTime, threadId);
    }
    // leaseTime <= 0 means "no expiry": take the watchdog lease and keep renewing it.
    this.internalLockLeaseTime = LOCK_WATCHDOG_TIMEOUT_MS;
    const ttl = await this.tryLockInner(LOCK_WATCHDOG_TIMEOUT_MS, threadId);
    if (ttl === null) {
      this.scheduleExpirationRenewal(threadId);
    }
    return ttl;
  }

  /** Extend the lease every `internalLockLeaseTime / 3` while this thread holds it. */
  private scheduleExpirationRenewal(threadId: number): void {
    if (this.renewals.has(threadId)) {
      return;
    }
    const timer = setInterval(() => {
      void this.renewExpiration(threadId);
    }, this.internalLockLeaseTime / 3);
    timer.unref?.();
    this.renewals.set(threadId, timer);
  }

  private async renewExpiration(threadId: number): Promise<void> {
    try {
      const renewed = await this.redis.eval(
        RENEW_SCRIPT,
        1,
        this.name,
        String(this.internalLockLeaseTime),
        this.heldField(threadId),
      );
      if (renewed !== 1) {
        this.cancelExpirationRenewal(threadId);
      }
    } catch {
      this.cancelExpirationRenewal(threadId);
    }
  }

  protected cancelExpirationRenewal(threadId: number): void {
    const timer = this.renewals.get(threadId);
    if (timer) {
      clearInterval(timer);
      this.renewals.delete(threadId);
    }
  }
}

export class RedissonLock extends RedissonBaseLock {
  protected override heldField(threadId: number): string {
    return this.getLockName(threadId);
  }

  protected override async tryLockInner(
    leaseMillis: number,
    threadId: number,
  ): Promise<number | null> {
    const result = await this.redis.eval(
      TRY_LOCK_SCRIPT,
      1,
      this.name,
      String(leaseMillis),
      this.getLockName(threadId),
    );
    return result === null ? null : Number(result);
  }
}
