import type { JoinPoint } from '../deps/aspect.js';
import { Thread } from '../deps/thread.js';
import type { LockTimeoutHandler } from '../handler/lock/lock-timeout-handler.js';
import { KlockTimeoutException } from '../handler/klock-timeout-exception.js';
import type { Lock } from '../lock/lock.js';
import type { LockInfo } from './lock-info.js';

const DEFAULT_INTERVAL = 100;
const DEFAULT_MAX_INTERVAL = 3 * 60 * 1000;

/**
 * What to do when the lock could not be acquired.
 *
 * @author wanglaomo
 * @since 2019/4/15
 */
export class LockTimeoutStrategy implements LockTimeoutHandler {
  /** Carry on with the business logic; do nothing. */
  static readonly NO_OPERATION = new LockTimeoutStrategy('NO_OPERATION', async () => {
    // do nothing
  });

  /** Fail fast. */
  static readonly FAIL_FAST = new LockTimeoutStrategy('FAIL_FAST', async (lockInfo) => {
    const errorMsg = `Failed to acquire Lock(${lockInfo.getName()}) with timeout(${lockInfo.getWaitTime()}s)`;
    throw new KlockTimeoutException(errorMsg);
  });

  /** Block until the lock is acquired; after too many attempts, still fail. */
  static readonly KEEP_ACQUIRE = new LockTimeoutStrategy(
    'KEEP_ACQUIRE',
    async (lockInfo, lock) => {
      let interval = DEFAULT_INTERVAL;

      while (!(await lock.acquire())) {
        if (interval > DEFAULT_MAX_INTERVAL) {
          const errorMsg = `Failed to acquire Lock(${lockInfo.getName()}) after too many times, this may because dead lock occurs.`;
          throw new KlockTimeoutException(errorMsg);
        }

        await Thread.sleep(interval);
        interval <<= 1;
      }
    },
  );

  private constructor(
    private readonly constantName: string,
    private readonly handler: (
      lockInfo: LockInfo,
      lock: Lock,
      joinPoint: JoinPoint,
    ) => Promise<void>,
  ) {}

  handle(lockInfo: LockInfo, lock: Lock, joinPoint: JoinPoint): Promise<void> {
    return this.handler(lockInfo, lock, joinPoint);
  }

  name(): string {
    return this.constantName;
  }

  toString(): string {
    return this.constantName;
  }

  /** `LockTimeoutStrategy.valueOf(name)`. */
  static valueOf(name: string): LockTimeoutStrategy {
    for (const value of LockTimeoutStrategy.values()) {
      if (value.name() === name) {
        return value;
      }
    }
    throw new Error(`No enum constant LockTimeoutStrategy.${name}`);
  }

  static values(): readonly LockTimeoutStrategy[] {
    return [
      LockTimeoutStrategy.NO_OPERATION,
      LockTimeoutStrategy.FAIL_FAST,
      LockTimeoutStrategy.KEEP_ACQUIRE,
    ];
  }
}
