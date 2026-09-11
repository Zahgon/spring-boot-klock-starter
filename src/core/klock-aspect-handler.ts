import type { AnyMethod, JoinPoint, ProceedingJoinPoint } from '../deps/aspect.js';
import { getDeclaredMethod } from '../deps/aspect.js';
import { IllegalArgumentException, NullPointerException } from '../deps/java-lang.js';
import { LoggerFactory } from '../deps/logger.js';
import { isEmpty } from '../deps/string-utils.js';
import { Thread } from '../deps/thread.js';
import type { KlockAnnotation } from '../annotation/klock.js';
import type { Lock } from '../lock/lock.js';
import type { LockFactory } from '../lock/lock-factory.js';
import type { LockInfo } from '../model/lock-info.js';
import type { LockInfoProvider } from './lock-info-provider.js';

/**
 * Created by kl on 2017/12/29.
 * Content: the advice that locks around every `@Klock` method.
 *
 * The three pieces of advice are nested exactly as Spring AOP orders them —
 * `@Around` outermost, then `@AfterReturning`, then `@AfterThrowing`, then the
 * method itself. {@link around} therefore calls {@link proceed}, which owns the
 * after-advice; an around advice that returns early skips it, which is what the
 * custom lock-timeout strategy relies on.
 */
export class KlockAspectHandler {
  private static readonly logger = LoggerFactory.getLogger('KlockAspectHandler');

  private readonly currentThreadLock = new Map<string, LockRes>();

  constructor(
    private readonly lockFactory: LockFactory,
    private readonly lockInfoProvider: LockInfoProvider,
  ) {}

  /** `@Around(value = "@annotation(klock)")` */
  async around(joinPoint: ProceedingJoinPoint, klock: KlockAnnotation): Promise<unknown> {
    const lockInfo = this.lockInfoProvider.get(joinPoint, klock);
    const curentLock = this.getCurrentLockId(joinPoint, klock);
    this.currentThreadLock.set(curentLock, new LockRes(lockInfo, false));
    const lock = this.lockFactory.getLock(lockInfo);
    const lockRes = await lock.acquire();

    // Acquiring the lock failed: enter the failure handling.
    if (!lockRes) {
      if (KlockAspectHandler.logger.isWarnEnabled()) {
        KlockAspectHandler.logger.warn('Timeout while acquiring Lock({})', lockInfo.getName());
      }
      // A custom acquire-failure strategy takes over the whole invocation.
      if (!isEmpty(klock.customLockTimeoutStrategy)) {
        return await this.handleCustomLockTimeout(klock.customLockTimeoutStrategy, joinPoint);
      }
      // Otherwise run the predefined strategy. Note: with no strategy given the
      // default is to stay silent and carry on.
      await klock.lockTimeoutStrategy.handle(lockInfo, lock, joinPoint);
    }

    const entry = this.currentThreadLock.get(curentLock) as LockRes;
    entry.setLock(lock);
    entry.setRes(true);

    return await this.proceed(joinPoint, klock);
  }

  /** The nested after-advice: `@AfterReturning` wrapping `@AfterThrowing` wrapping the method. */
  private async proceed(joinPoint: ProceedingJoinPoint, klock: KlockAnnotation): Promise<unknown> {
    let result: unknown;
    try {
      result = await joinPoint.proceed();
    } catch (ex) {
      await this.afterThrowing(joinPoint, klock, ex);
    }
    await this.afterReturning(joinPoint, klock);
    return result;
  }

  /** `@AfterReturning(value = "@annotation(klock)")` */
  async afterReturning(joinPoint: JoinPoint, klock: KlockAnnotation): Promise<void> {
    const curentLock = this.getCurrentLockId(joinPoint, klock);
    await this.releaseLock(klock, joinPoint, curentLock);
    this.cleanUpThreadLocal(curentLock);
  }

  /** `@AfterThrowing(value = "@annotation(klock)", throwing = "ex")` */
  async afterThrowing(joinPoint: JoinPoint, klock: KlockAnnotation, ex: unknown): Promise<never> {
    const curentLock = this.getCurrentLockId(joinPoint, klock);
    await this.releaseLock(klock, joinPoint, curentLock);
    this.cleanUpThreadLocal(curentLock);
    throw ex;
  }

  /** Handle a custom acquire timeout. */
  private async handleCustomLockTimeout(
    lockTimeoutHandler: string,
    joinPoint: JoinPoint,
  ): Promise<unknown> {
    // prepare invocation context
    const currentMethod = joinPoint.getSignature().getMethod();
    const target = joinPoint.getTarget();
    const handleMethod: AnyMethod | null = getDeclaredMethod(
      target,
      lockTimeoutHandler,
      currentMethod.getParameterCount(),
    );
    if (handleMethod === null) {
      throw new IllegalArgumentException(
        'Illegal annotation param customLockTimeoutStrategy',
        new Error(`No such method: ${lockTimeoutHandler}`),
      );
    }
    const args = joinPoint.getArgs();

    // invoke
    return await (handleMethod as (...invocationArgs: unknown[]) => unknown).apply(target, args);
  }

  /** Release the lock. */
  private async releaseLock(
    klock: KlockAnnotation,
    joinPoint: JoinPoint,
    curentLock: string,
  ): Promise<void> {
    const lockRes = this.currentThreadLock.get(curentLock);
    if (lockRes === undefined) {
      throw new NullPointerException(
        'Please check whether the input parameter used as the lock key value has been modified in the method, ' +
          'which will cause the acquire and release locks to have different key values and throw null pointers.' +
          `curentLockKey:${curentLock}`,
      );
    }
    if (lockRes.getRes()) {
      const releaseRes = await (lockRes.getLock() as Lock).release();
      // avoid release lock twice when exception happens below
      lockRes.setRes(false);
      if (!releaseRes) {
        await this.handleReleaseTimeout(klock, lockRes.getLockInfo(), joinPoint);
      }
    }
  }

  // avoid memory leak
  private cleanUpThreadLocal(curentLock: string): void {
    this.currentThreadLock.delete(curentLock);
  }

  /** The key this lock is filed under. */
  private getCurrentLockId(joinPoint: JoinPoint, klock: KlockAnnotation): string {
    const lockInfo = this.lockInfoProvider.get(joinPoint, klock);
    return `${Thread.currentThread().getId()}${lockInfo.getName()}`;
  }

  /** Handle a lock that had already expired at release time. */
  private async handleReleaseTimeout(
    klock: KlockAnnotation,
    lockInfo: LockInfo,
    joinPoint: JoinPoint,
  ): Promise<void> {
    if (KlockAspectHandler.logger.isWarnEnabled()) {
      KlockAspectHandler.logger.warn('Timeout while release Lock({})', lockInfo.getName());
    }

    if (!isEmpty(klock.customReleaseTimeoutStrategy)) {
      await this.handleCustomReleaseTimeout(klock.customReleaseTimeoutStrategy, joinPoint);
      return;
    }

    klock.releaseTimeoutStrategy.handle(lockInfo);
  }

  /** Handle a custom release timeout. */
  private async handleCustomReleaseTimeout(
    releaseTimeoutHandler: string,
    joinPoint: JoinPoint,
  ): Promise<void> {
    const currentMethod = joinPoint.getSignature().getMethod();
    const target = joinPoint.getTarget();
    const handleMethod: AnyMethod | null = getDeclaredMethod(
      target,
      releaseTimeoutHandler,
      currentMethod.getParameterCount(),
    );
    if (handleMethod === null) {
      throw new IllegalArgumentException(
        'Illegal annotation param customReleaseTimeoutStrategy',
        new Error(`No such method: ${releaseTimeoutHandler}`),
      );
    }
    const args = joinPoint.getArgs();

    await (handleMethod as (...invocationArgs: unknown[]) => unknown).apply(target, args);
  }
}

class LockRes {
  private lock: Lock | null = null;

  constructor(
    private readonly lockInfo: LockInfo,
    private res: boolean,
  ) {}

  getLockInfo(): LockInfo {
    return this.lockInfo;
  }

  getLock(): Lock | null {
    return this.lock;
  }

  setLock(lock: Lock): void {
    this.lock = lock;
  }

  getRes(): boolean {
    return this.res;
  }

  setRes(res: boolean): void {
    this.res = res;
  }
}
