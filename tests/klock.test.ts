import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { IllegalStateException } from '../src/deps/java-lang.js';
import { Thread, TimeUnit } from '../src/deps/thread.js';
import { KlockTimeoutException } from '../src/handler/klock-timeout-exception.js';
import { KlockTestApplication } from './fixtures/klock-test-application.js';
import type { TestService } from './fixtures/test-service.js';
import type { TimeoutService } from './fixtures/timeout-service.js';
import { User } from './fixtures/user.js';
import { CountDownLatch, Executors } from './support/concurrent.js';

/**
 * Ported from `KlockTests.java`. Every test keeps its name, its inputs and its
 * assertions.
 */
describe('KlockTests', () => {
  let application: KlockTestApplication;
  let testService: TestService;
  let timeoutService: TimeoutService;

  beforeAll(async () => {
    application = await KlockTestApplication.run();
    testService = application.testService;
    timeoutService = application.timeoutService;
  });

  afterAll(async () => {
    await application.close();
  });

  /** Acquiring the lock from several threads inside one process. */
  test('multithreadingTest', async () => {
    const executorService = Executors.newFixedThreadPool(6);
    for (let i = 0; i < 10; i++) {
      void executorService.submit(async () => {
        try {
          const result = await testService.getValue('sleep');
          process.stderr.write(
            `thread:[${Thread.currentThread().getName()}] got => ${result}${new Date().toString()}\n`,
          );
        } catch (e) {
          process.stderr.write(`${String(e)}\n`);
        }
      });
    }
    await executorService.awaitTermination(30 * 1000);
  });

  /** Sleeps for 3 seconds. */
  test('jvm1', async () => {
    const result = await testService.getValue('sleep');
    expect(result).toEqual('success');
  });

  /** No sleep. */
  test('jvm2', async () => {
    const result = await testService.getValue('noSleep');
    expect(result).toEqual('success');
  });

  /** No sleep. */
  test('jvm3', async () => {
    const result = await testService.getValue('noSleep');
    expect(result).toEqual('success');
  });
  // Run jvm1 and jvm2 one after the other: although jvm2 does not sleep, getValue
  // is locked, so both finish at about the same time once jvm1 holds the lock.

  /** Business key. */
  test('businessKeyJvm1', async () => {
    const result = await testService.getValueByUserId('user1', null);
    expect(result).toEqual('success');
  });

  /** Business key. */
  test('businessKeyJvm2', async () => {
    const result = await testService.getValueByUserId('user1', 1);
    expect(result).toEqual('success');
  });

  /** Business key. */
  test('businessKeyJvm3', async () => {
    const result = await testService.getValueByUserId('user1', 2);
    expect(result).toEqual('success');
  });

  /** Business key. */
  test('businessKeyJvm4', async () => {
    const result = await testService.getValueByUser(new User(3, null));
    expect(result).toEqual('success');
  });

  /** The watchdog extends the lease indefinitely. */
  test('infiniteLeaseTime', async () => {
    await timeoutService.foo1();
  });

  /** Acquiring the lock times out and fails fast. */
  test('lockTimeoutFailFast', async () => {
    const executorService = Executors.newFixedThreadPool(10);

    void executorService.submit(() => timeoutService.foo1());

    await TimeUnit.MILLISECONDS.sleep(1000);

    await expect(timeoutService.foo2()).rejects.toThrow(KlockTimeoutException);
  });

  /**
   * Acquiring the lock times out and keeps waiting.
   * Prints "acquire lock" ten times.
   */
  test('lockTimeoutKeepAcquire', async () => {
    const executorService = Executors.newFixedThreadPool(10);
    const startLatch = new CountDownLatch(1);
    const endLatch = new CountDownLatch(10);

    for (let i = 0; i < 10; i++) {
      void executorService.submit(async () => {
        try {
          await startLatch.await();
          await timeoutService.foo3();
        } finally {
          endLatch.countDown();
        }
      });
    }

    const start = Date.now();
    startLatch.countDown();
    await endLatch.await();
    const end = Date.now();
    expect(end - start).toBeGreaterThanOrEqual(10 * 2 * 1000);
  });

  /**
   * A custom acquire-timeout strategy.
   * Runs the custom strategy once.
   */
  test('lockTimeoutCustom', async () => {
    const executorService = Executors.newFixedThreadPool(10);
    const latch = new CountDownLatch(2);

    void executorService.submit(async () => {
      await timeoutService.foo1();
      latch.countDown();
    });

    void executorService.submit(async () => {
      await timeoutService.foo4('foo', 'bar');
      latch.countDown();
    });

    await latch.await();
  });

  /** Acquiring the lock times out and nothing happens. */
  test('lockTimeoutNoOperation', async () => {
    const executorService = Executors.newFixedThreadPool(10);
    const startLatch = new CountDownLatch(1);
    const endLatch = new CountDownLatch(10);

    for (let i = 0; i < 10; i++) {
      void executorService.submit(async () => {
        try {
          await startLatch.await();
          await timeoutService.foo5('foo', 'bar');
        } catch (e) {
          process.stderr.write(`${String(e)}\n`);
        } finally {
          endLatch.countDown();
        }
      });
    }

    const start = Date.now();
    startLatch.countDown();
    await endLatch.await();
    const end = Date.now();
    expect(end - start).toBeLessThan(10 * 2 * 1000);
  });

  /** The lease had not expired at release time: nothing happens. */
  test('releaseTimeoutNoOperation', async () => {
    await timeoutService.foo6('foo', 'bar');
  });

  /** The lease had expired at release time: fail fast. */
  test('releaseTimeoutFailFast', async () => {
    await expect(timeoutService.foo7('foo', 'bar')).rejects.toThrow(KlockTimeoutException);
  });

  /** The lease had expired at release time: custom strategy. */
  test('releaseTimeoutCustom', async () => {
    await expect(timeoutService.foo8('foo', 'bar')).rejects.toThrow(IllegalStateException);
  });
});
