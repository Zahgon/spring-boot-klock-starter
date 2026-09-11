import type { JoinPoint, MethodSignature } from '../deps/aspect.js';
import { LoggerFactory } from '../deps/logger.js';
import type { KlockAnnotation } from '../annotation/klock.js';
import { LONG_MIN_VALUE } from '../annotation/klock.js';
import type { KlockConfig } from '../config/klock-config.js';
import { LockInfo } from '../model/lock-info.js';
import type { LockType } from '../model/lock-type.js';
import type { BusinessKeyProvider } from './business-key-provider.js';

const LOCK_NAME_PREFIX = 'lock';
const LOCK_NAME_SEPARATOR = '.';

/**
 * Created by kl on 2017/12/29.
 */
export class LockInfoProvider {
  private static readonly logger = LoggerFactory.getLogger('LockInfoProvider');

  constructor(
    private readonly klockConfig: KlockConfig,
    private readonly businessKeyProvider: BusinessKeyProvider,
  ) {}

  get(joinPoint: JoinPoint, klock: KlockAnnotation): LockInfo {
    const signature: MethodSignature = joinPoint.getSignature();
    const type: LockType = klock.lockType;
    const businessKeyName = this.businessKeyProvider.getKeyName(joinPoint, klock);
    // The lock name — this is where the lock's granularity is decided.
    const lockName =
      LOCK_NAME_PREFIX + LOCK_NAME_SEPARATOR + this.getName(klock.name, signature) + businessKeyName;
    const waitTime = this.getWaitTime(klock);
    const leaseTime = this.getLeaseTime(klock);
    // Warn when the lease time is set to something dangerous.
    if (leaseTime === -1 && LockInfoProvider.logger.isWarnEnabled()) {
      LockInfoProvider.logger.warn(
        'Trying to acquire Lock({}) with no expiration, ' +
          'Klock will keep prolong the lock expiration while the lock is still holding by current thread. ' +
          'This may cause dead lock in some circumstances.',
        lockName,
      );
    }
    return new LockInfo(type, lockName, waitTime, leaseTime);
  }

  /** The lock name: the declaring type and method name when the annotation gives none. */
  private getName(annotationName: string, signature: MethodSignature): string {
    if (annotationName.length === 0) {
      return `${signature.getDeclaringTypeName()}.${signature.getMethod().getName()}`;
    }
    return annotationName;
  }

  private getWaitTime(lock: KlockAnnotation): number {
    return lock.waitTime === LONG_MIN_VALUE ? this.klockConfig.getWaitTime() : lock.waitTime;
  }

  private getLeaseTime(lock: KlockAnnotation): number {
    return lock.leaseTime === LONG_MIN_VALUE ? this.klockConfig.getLeaseTime() : lock.leaseTime;
  }
}
