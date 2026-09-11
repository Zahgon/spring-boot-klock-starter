import type { LockInfo } from '../../model/lock-info.js';

/**
 * Strategy interface for "the lock had already gone when it was released".
 *
 * @author wanglaomo
 * @since 2019/4/15
 */
export interface ReleaseTimeoutHandler {
  handle(lockInfo: LockInfo): void;
}
