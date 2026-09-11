import type { AnyMethod, ProceedingJoinPoint } from '../deps/aspect.js';
import { MethodInvocationJoinPoint } from '../deps/aspect.js';
import { LockType } from '../model/lock-type.js';
import { LockTimeoutStrategy } from '../model/lock-timeout-strategy.js';
import { ReleaseTimeoutStrategy } from '../model/release-timeout-strategy.js';
import { getKlockAspectHandler } from '../core/klock-runtime.js';

/**
 * `Long.MIN_VALUE`, the sentinel `@Klock` uses for "not specified". It is exactly
 * representable as a double, so the comparison behaves as it does in Java.
 */
export const LONG_MIN_VALUE = -9223372036854775808;

/**
 * @author kl
 * @since 2017/12/29
 * Content: the locking annotation.
 */
export interface KlockAnnotation {
  /** Name of the lock. */
  name: string;
  /** Lock type; reentrant by default. */
  lockType: LockType;
  /** Maximum time to wait while trying to acquire the lock. */
  waitTime: number;
  /** Automatically release the lock this many seconds after acquiring it. */
  leaseTime: number;
  /** Custom business keys. */
  keys: string[];
  /** What to do when acquiring the lock timed out. */
  lockTimeoutStrategy: LockTimeoutStrategy;
  /** Custom strategy for when acquiring the lock timed out. */
  customLockTimeoutStrategy: string;
  /** What to do when the lock had already expired at release time. */
  releaseTimeoutStrategy: ReleaseTimeoutStrategy;
  /** Custom strategy for when the lock had already expired at release time. */
  customReleaseTimeoutStrategy: string;
}

export type KlockOptions = Partial<KlockAnnotation>;

/** Apply `@Klock`'s declared defaults to the options a caller supplied. */
export function withDefaults(options: KlockOptions = {}): KlockAnnotation {
  return {
    name: options.name ?? '',
    lockType: options.lockType ?? LockType.Reentrant,
    waitTime: options.waitTime ?? LONG_MIN_VALUE,
    leaseTime: options.leaseTime ?? LONG_MIN_VALUE,
    keys: options.keys ?? [],
    lockTimeoutStrategy: options.lockTimeoutStrategy ?? LockTimeoutStrategy.NO_OPERATION,
    customLockTimeoutStrategy: options.customLockTimeoutStrategy ?? '',
    releaseTimeoutStrategy: options.releaseTimeoutStrategy ?? ReleaseTimeoutStrategy.NO_OPERATION,
    customReleaseTimeoutStrategy: options.customReleaseTimeoutStrategy ?? '',
  };
}

/**
 * Lock the annotated method. Applicable to methods only.
 *
 * Spring AOP nests `@Around` outside the after-advice, so an around advice that
 * returns without proceeding skips the after-advice entirely. The wrapper below
 * preserves that: it hands control to the aspect handler, which decides whether
 * the annotated method runs at all.
 */
export function Klock(options: KlockOptions = {}): MethodDecorator {
  const annotation = withDefaults(options);
  return (target, propertyKey, descriptor) => {
    const original = (descriptor as TypedPropertyDescriptor<unknown>).value as AnyMethod;
    if (typeof original !== 'function') {
      throw new Error('@Klock is only supported on methods');
    }
    const methodName = String(propertyKey);
    const prototype = target as object;

    // `async` so that a configuration error surfaces as a rejected promise
    // rather than a synchronous throw from a method that returns one.
    (descriptor as TypedPropertyDescriptor<unknown>).value = async function (
      this: object,
      ...args: unknown[]
    ): Promise<unknown> {
      const joinPoint: ProceedingJoinPoint = new MethodInvocationJoinPoint(
        this,
        prototype,
        methodName,
        original,
        args,
      );
      return await getKlockAspectHandler().around(joinPoint, annotation);
    } as unknown as typeof original;

    return descriptor;
  };
}
