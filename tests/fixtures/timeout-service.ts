import { Klock } from '../../src/annotation/klock.js';
import { LoggerFactory } from '../../src/deps/logger.js';
import { IllegalStateException } from '../../src/deps/java-lang.js';
import { TimeUnit } from '../../src/deps/thread.js';
import { LockTimeoutStrategy } from '../../src/model/lock-timeout-strategy.js';
import { ReleaseTimeoutStrategy } from '../../src/model/release-timeout-strategy.js';

const logger = LoggerFactory.getLogger('TimeoutService');

/**
 * @author wanglaomo
 * @since 2019/4/16
 */
export class TimeoutService {
  @Klock({
    name: 'foo-service',
    leaseTime: -1,
    releaseTimeoutStrategy: ReleaseTimeoutStrategy.FAIL_FAST,
  })
  async foo1(): Promise<void> {
    logger.info('foo1 acquire lock');
    await TimeUnit.SECONDS.sleep(3);
  }

  @Klock({ name: 'foo-service', waitTime: 2, lockTimeoutStrategy: LockTimeoutStrategy.FAIL_FAST })
  async foo2(): Promise<void> {
    logger.info('acquire lock');
    await TimeUnit.SECONDS.sleep(2);
  }

  @Klock({ name: 'foo-service', waitTime: 2, lockTimeoutStrategy: LockTimeoutStrategy.KEEP_ACQUIRE })
  async foo3(): Promise<void> {
    await TimeUnit.SECONDS.sleep(2);
    logger.info('acquire lock');
  }

  @Klock({ name: 'foo-service', waitTime: 2, customLockTimeoutStrategy: 'customLockTimeout' })
  async foo4(foo: string, bar: string): Promise<string> {
    void foo;
    void bar;
    await TimeUnit.SECONDS.sleep(2);
    logger.info('acquire lock');

    return 'foo4';
  }

  // Resolved reflectively by name, so it is never referenced directly.
  protected customLockTimeout(foo: string, bar: string): string {
    logger.info('customLockTimeout foo: ' + foo + ' bar: ' + bar);
    return 'custom foo: ' + foo + ' bar: ' + bar;
  }

  @Klock({ name: 'foo-service', waitTime: 10 })
  async foo5(foo: string, bar: string): Promise<void> {
    void foo;
    void bar;
    await TimeUnit.SECONDS.sleep(2);
    logger.info('acquire lock');
  }

  @Klock({ name: 'foo-service', leaseTime: 10, waitTime: 10000 })
  async foo6(foo: string, bar: string): Promise<void> {
    void foo;
    void bar;
    await TimeUnit.SECONDS.sleep(2);
    logger.info('acquire lock');
  }

  @Klock({
    name: 'foo-service',
    leaseTime: 1,
    waitTime: 10000,
    releaseTimeoutStrategy: ReleaseTimeoutStrategy.FAIL_FAST,
  })
  async foo7(foo: string, bar: string): Promise<void> {
    void foo;
    void bar;
    await TimeUnit.SECONDS.sleep(2);
    logger.info('acquire lock');
  }

  @Klock({
    name: 'foo-service',
    leaseTime: 1,
    waitTime: 10000,
    customReleaseTimeoutStrategy: 'customReleaseTimeout',
  })
  async foo8(foo: string, bar: string): Promise<string> {
    void foo;
    void bar;
    await TimeUnit.SECONDS.sleep(2);
    return 'foo8';
  }

  // Resolved reflectively by name, so it is never referenced directly.
  protected customReleaseTimeout(foo: string, bar: string): string {
    void foo;
    void bar;
    throw new IllegalStateException('customReleaseTimeout');
  }
}
