import type { JoinPoint } from '../../deps/aspect.js';
import type { Lock } from '../../lock/lock.js';
import type { LockInfo } from '../../model/lock-info.js';

/**
 * Strategy interface for "the lock could not be acquired".
 *
 * @author wanglaomo
 * @since 2019/4/15
 */
export interface LockTimeoutHandler {
  handle(lockInfo: LockInfo, lock: Lock, joinPoint: JoinPoint): Promise<void>;
}
