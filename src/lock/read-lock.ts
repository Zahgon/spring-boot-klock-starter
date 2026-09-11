import type { RedissonClient, RReadWriteLock } from '../deps/redisson/index.js';
import { TimeUnit } from '../deps/thread.js';
import type { LockInfo } from '../model/lock-info.js';
import type { Lock } from './lock.js';

/**
 * Created by kl on 2017/12/29.
 */
export class ReadLock implements Lock {
  private rLock: RReadWriteLock | null = null;

  constructor(
    private readonly redissonClient: RedissonClient,
    private readonly lockInfo: LockInfo,
  ) {}

  async acquire(): Promise<boolean> {
    this.rLock = this.redissonClient.getReadWriteLock(this.lockInfo.getName());
    return await this.rLock
      .readLock()
      .tryLock(this.lockInfo.getWaitTime(), this.lockInfo.getLeaseTime(), TimeUnit.SECONDS);
  }

  async release(): Promise<boolean> {
    if (this.rLock && (await this.rLock.readLock().isHeldByCurrentThread())) {
      return await this.rLock.readLock().forceUnlock();
    }
    return false;
  }
}
