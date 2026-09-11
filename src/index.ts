/**
 * spring-boot-klock-starter — Redis-backed distributed locking behind a single
 * `@Klock` decorator.
 */

export { Klock, LONG_MIN_VALUE, withDefaults } from './annotation/klock.js';
export type { KlockAnnotation, KlockOptions } from './annotation/klock.js';
export { KLOCK_KEY, KlockKey } from './annotation/klock-key.js';
export type { KlockKeyAnnotation } from './annotation/klock-key.js';

export { ClusterServer, KlockConfig } from './config/klock-config.js';
export {
  bindKlockConfig,
  isKlockEnabled,
  parseProperties,
  resolveProperty,
  toEnvironmentName,
} from './config/klock-properties.js';
export type { PropertySource } from './config/klock-properties.js';

export { BusinessKeyProvider } from './core/business-key-provider.js';
export { KlockAspectHandler } from './core/klock-aspect-handler.js';
export { LockInfoProvider } from './core/lock-info-provider.js';
export { getKlockAspectHandler, setKlockAspectHandler } from './core/klock-runtime.js';

export { KlockInvocationException } from './handler/klock-invocation-exception.js';
export { KlockTimeoutException } from './handler/klock-timeout-exception.js';
export type { LockTimeoutHandler } from './handler/lock/lock-timeout-handler.js';
export type { ReleaseTimeoutHandler } from './handler/release/release-timeout-handler.js';

export { FairLock } from './lock/fair-lock.js';
export type { Lock } from './lock/lock.js';
export { LockFactory } from './lock/lock-factory.js';
export { ReadLock } from './lock/read-lock.js';
export { ReentrantLock } from './lock/reentrant-lock.js';
export { WriteLock } from './lock/write-lock.js';

export { LockInfo } from './model/lock-info.js';
export { LockTimeoutStrategy } from './model/lock-timeout-strategy.js';
export { LockType } from './model/lock-type.js';
export { ReleaseTimeoutStrategy } from './model/release-timeout-strategy.js';

export { buildContext, KlockAutoConfiguration } from './klock-auto-configuration.js';
export type { KlockContext } from './klock-auto-configuration.js';
export { KlockConfiguration } from './klock-configuration.js';

export {
  IllegalArgumentException,
  IllegalStateException,
  NullPointerException,
} from './deps/java-lang.js';
export { Thread, TimeUnit } from './deps/thread.js';
export type { JoinPoint, ProceedingJoinPoint } from './deps/aspect.js';
export { Redisson } from './deps/redisson/index.js';
export type { RedissonClient, RLock, RReadWriteLock } from './deps/redisson/index.js';
