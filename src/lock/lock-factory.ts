import type { RedissonClient } from '../deps/redisson/index.js';
import type { LockInfo } from '../model/lock-info.js';
import { LockType } from '../model/lock-type.js';
import { FairLock } from './fair-lock.js';
import type { Lock } from './lock.js';
import { ReadLock } from './read-lock.js';
import { ReentrantLock } from './reentrant-lock.js';
import { WriteLock } from './write-lock.js';

/**
 * Created by kl on 2017/12/29.
 */
export class LockFactory {
  constructor(private readonly redissonClient: RedissonClient) {}

  getLock(lockInfo: LockInfo): Lock {
    switch (lockInfo.getType()) {
      case LockType.Reentrant:
        return new ReentrantLock(this.redissonClient, lockInfo);
      case LockType.Fair:
        return new FairLock(this.redissonClient, lockInfo);
      case LockType.Read:
        return new ReadLock(this.redissonClient, lockInfo);
      case LockType.Write:
        return new WriteLock(this.redissonClient, lockInfo);
      default:
        return new ReentrantLock(this.redissonClient, lockInfo);
    }
  }
}
