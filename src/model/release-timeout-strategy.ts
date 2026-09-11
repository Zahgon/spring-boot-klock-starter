import { KlockTimeoutException } from '../handler/klock-timeout-exception.js';
import type { ReleaseTimeoutHandler } from '../handler/release/release-timeout-handler.js';
import type { LockInfo } from './lock-info.js';

/**
 * What to do when the lock had already been released by the time the method
 * finished.
 *
 * @author wanglaomo
 * @since 2019/4/15
 */
export class ReleaseTimeoutStrategy implements ReleaseTimeoutHandler {
  /** Carry on with the business logic; do nothing. */
  static readonly NO_OPERATION = new ReleaseTimeoutStrategy('NO_OPERATION', () => {
    // do nothing
  });

  /** Fail fast. */
  static readonly FAIL_FAST = new ReleaseTimeoutStrategy('FAIL_FAST', (lockInfo) => {
    const errorMsg = `Found Lock(${lockInfo.getName()}) already been released while lock lease time is ${lockInfo.getLeaseTime()} s`;
    throw new KlockTimeoutException(errorMsg);
  });

  private constructor(
    private readonly constantName: string,
    private readonly handler: (lockInfo: LockInfo) => void,
  ) {}

  handle(lockInfo: LockInfo): void {
    this.handler(lockInfo);
  }

  name(): string {
    return this.constantName;
  }

  toString(): string {
    return this.constantName;
  }

  /** `ReleaseTimeoutStrategy.valueOf(name)`. */
  static valueOf(name: string): ReleaseTimeoutStrategy {
    for (const value of ReleaseTimeoutStrategy.values()) {
      if (value.name() === name) {
        return value;
      }
    }
    throw new Error(`No enum constant ReleaseTimeoutStrategy.${name}`);
  }

  static values(): readonly ReleaseTimeoutStrategy[] {
    return [ReleaseTimeoutStrategy.NO_OPERATION, ReleaseTimeoutStrategy.FAIL_FAST];
  }
}
