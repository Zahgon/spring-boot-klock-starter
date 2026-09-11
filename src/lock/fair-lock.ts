import type { RedissonClient, RLock } from '../deps/redisson/index.js';
import { TimeUnit } from '../deps/thread.js';
import type { LockInfo } from '../model/lock-info.js';
import type { Lock } from './lock.js';

/**
 * Created by kl on 2017/12/29.
 */
export class FairLock implements Lock {
  private rLock: RLock | null = null;

  constructor(
    private readonly redissonClient: RedissonClient,
    private readonly lockInfo: LockInfo,
  ) {}

  async acquire(): Promise<boolean> {
    this.rLock = this.redissonClient.getFairLock(this.lockInfo.getName());
    return await this.rLock.tryLock(
      this.lockInfo.getWaitTime(),
      this.lockInfo.getLeaseTime(),
      TimeUnit.SECONDS,
    );
  }

  async release(): Promise<boolean> {
    if (this.rLock && (await this.rLock.isHeldByCurrentThread())) {
      return await this.rLock.forceUnlock();
    }
    return false;
  }
}
