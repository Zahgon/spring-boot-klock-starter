import { afterEach, describe, expect, test } from 'vitest';

import { Klock } from '../src/annotation/klock.js';
import { KlockConfig } from '../src/config/klock-config.js';
import { BusinessKeyProvider } from '../src/core/business-key-provider.js';
import { KlockAspectHandler } from '../src/core/klock-aspect-handler.js';
import { LockInfoProvider } from '../src/core/lock-info-provider.js';
import { getKlockAspectHandler, setKlockAspectHandler } from '../src/core/klock-runtime.js';
import { IllegalArgumentException, NullPointerException } from '../src/deps/java-lang.js';
import type { RedissonClient, RLock, RReadWriteLock } from '../src/deps/redisson/index.js';
import { KlockTimeoutException } from '../src/handler/klock-timeout-exception.js';
import { LockFactory } from '../src/lock/lock-factory.js';
import { KlockAutoConfiguration } from '../src/klock-auto-configuration.js';
import { KlockConfiguration } from '../src/klock-configuration.js';
import { LockTimeoutStrategy } from '../src/model/lock-timeout-strategy.js';
import { ReleaseTimeoutStrategy } from '../src/model/release-timeout-strategy.js';

/**
 * The advice's control flow, exercised without a Redis so every branch —
 * including the failure branches the end-to-end suite never reaches — is
 * covered.
 */
interface FakeBehaviour {
  acquire: boolean;
  held: boolean;
  forceUnlock: boolean;
}

class FakeLock implements RLock {
  constructor(
    private readonly lockName: string,
    private readonly behaviour: FakeBehaviour,
    private readonly log: string[],
  ) {}

  getName(): string {
    return this.lockName;
  }

  async tryLock(): Promise<boolean> {
    this.log.push(`tryLock ${this.lockName}`);
    return this.behaviour.acquire;
  }

  async isHeldByCurrentThread(): Promise<boolean> {
    return this.behaviour.held;
  }

  async forceUnlock(): Promise<boolean> {
    this.log.push(`forceUnlock ${this.lockName}`);
    return this.behaviour.forceUnlock;
  }
}

class FakeRedissonClient implements RedissonClient {
  readonly log: string[] = [];
  shutdownCalls = 0;

  constructor(private readonly behaviour: FakeBehaviour) {}

  getLock(name: string): RLock {
    return new FakeLock(name, this.behaviour, this.log);
  }

  getFairLock(name: string): RLock {
    return new FakeLock(name, this.behaviour, this.log);
  }

  getReadWriteLock(name: string): RReadWriteLock {
    const lock = new FakeLock(name, this.behaviour, this.log);
    return { readLock: () => lock, writeLock: () => lock };
  }

  async connect(): Promise<void> {
    this.log.push('connect');
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls++;
  }
}

function configure(behaviour: FakeBehaviour): FakeRedissonClient {
  const client = new FakeRedissonClient(behaviour);
  const config = new KlockConfig();
  const businessKeyProvider = new BusinessKeyProvider();
  const lockInfoProvider = new LockInfoProvider(config, businessKeyProvider);
  setKlockAspectHandler(
    new KlockAspectHandler(new LockFactory(client), lockInfoProvider),
  );
  return client;
}

afterEach(() => {
  setKlockAspectHandler(null);
});

class Service {
  businessRuns = 0;
  handlerArgs: unknown[] = [];

  @Klock({ name: 'custom-timeout', customLockTimeoutStrategy: 'onTimeout' })
  async withCustomTimeout(foo: string, bar: string): Promise<string> {
    void foo;
    void bar;
    this.businessRuns++;
    return 'business';
  }

  protected onTimeout(foo: string, bar: string): string {
    this.handlerArgs = [foo, bar];
    return `custom foo: ${foo} bar: ${bar}`;
  }

  @Klock({ name: 'missing-timeout', customLockTimeoutStrategy: 'noSuchMethod' })
  async withMissingTimeoutHandler(): Promise<string> {
    return 'business';
  }

  @Klock({ name: 'missing-release', customReleaseTimeoutStrategy: 'noSuchMethod' })
  async withMissingReleaseHandler(): Promise<string> {
    return 'business';
  }

  @Klock({ name: 'throwing' })
  async throwing(): Promise<never> {
    throw new RangeError('business failure');
  }

  @Klock({ keys: ['#user.name'] })
  async mutatesItsKey(user: { name: string }): Promise<string> {
    user.name = 'changed';
    return 'done';
  }

  @Klock({ name: 'fail-fast', lockTimeoutStrategy: LockTimeoutStrategy.FAIL_FAST })
  async failFast(): Promise<string> {
    this.businessRuns++;
    return 'business';
  }

  @Klock({ name: 'no-op', lockTimeoutStrategy: LockTimeoutStrategy.NO_OPERATION })
  async noOperation(): Promise<string> {
    this.businessRuns++;
    return 'business';
  }

  @Klock({ name: 'release-fail-fast', releaseTimeoutStrategy: ReleaseTimeoutStrategy.FAIL_FAST })
  async releaseFailFast(): Promise<string> {
    return 'business';
  }
}

describe('around advice', () => {
  test('a custom acquire-timeout strategy replaces the invocation entirely', async () => {
    const client = configure({ acquire: false, held: true, forceUnlock: true });
    const service = new Service();

    await expect(service.withCustomTimeout('foo', 'bar')).resolves.toEqual(
      'custom foo: foo bar: bar',
    );
    expect(service.handlerArgs).toEqual(['foo', 'bar']);
    // The annotated method never ran, and — as in Spring, where @Around is the
    // outermost interceptor — the after-advice did not run either.
    expect(service.businessRuns).toEqual(0);
    expect(client.log).toEqual(['tryLock lock.custom-timeout']);
  });

  test('a custom strategy naming a method that does not exist is rejected', async () => {
    configure({ acquire: false, held: true, forceUnlock: true });
    const service = new Service();
    await expect(service.withMissingTimeoutHandler()).rejects.toThrow(IllegalArgumentException);
    await expect(service.withMissingTimeoutHandler()).rejects.toThrow(
      'Illegal annotation param customLockTimeoutStrategy',
    );
  });

  test('FAIL_FAST stops the invocation before the method runs', async () => {
    configure({ acquire: false, held: true, forceUnlock: true });
    const service = new Service();
    await expect(service.failFast()).rejects.toThrow(KlockTimeoutException);
    expect(service.businessRuns).toEqual(0);
  });

  test('NO_OPERATION lets the method run even though the lock was not acquired', async () => {
    configure({ acquire: false, held: true, forceUnlock: true });
    const service = new Service();
    await expect(service.noOperation()).resolves.toEqual('business');
    expect(service.businessRuns).toEqual(1);
  });

  test('the decorator refuses to run before the context is built', async () => {
    setKlockAspectHandler(null);
    expect(() => getKlockAspectHandler()).toThrow('Klock is not configured');
    const service = new Service();
    await expect(service.noOperation()).rejects.toThrow('Klock is not configured');
  });
});

describe('after advice', () => {
  test('a failing method releases the lock and then rethrows the original error', async () => {
    const client = configure({ acquire: true, held: true, forceUnlock: true });
    const service = new Service();
    await expect(service.throwing()).rejects.toThrow(RangeError);
    expect(client.log).toEqual(['tryLock lock.throwing', 'forceUnlock lock.throwing']);
  });

  test('a release that reports failure runs the release-timeout strategy', async () => {
    configure({ acquire: true, held: true, forceUnlock: false });
    const service = new Service();
    await expect(service.releaseFailFast()).rejects.toThrow(KlockTimeoutException);
    await expect(service.releaseFailFast()).rejects.toThrow(
      'Found Lock(lock.release-fail-fast) already been released while lock lease time is 60 s',
    );
  });

  test('a custom release strategy naming a method that does not exist is rejected', async () => {
    configure({ acquire: true, held: true, forceUnlock: false });
    const service = new Service();
    await expect(service.withMissingReleaseHandler()).rejects.toThrow(IllegalArgumentException);
    await expect(service.withMissingReleaseHandler()).rejects.toThrow(
      'Illegal annotation param customReleaseTimeoutStrategy',
    );
  });

  test('a method that changes an argument used as the lock key is reported', async () => {
    configure({ acquire: true, held: true, forceUnlock: true });
    const service = new Service();
    await expect(service.mutatesItsKey({ name: 'original' })).rejects.toThrow(
      NullPointerException,
    );
    await expect(service.mutatesItsKey({ name: 'original' })).rejects.toThrow(
      'Please check whether the input parameter used as the lock key value has been modified in the method',
    );
  });

  test('the lock is not released twice when the release itself fails', async () => {
    const client = configure({ acquire: true, held: true, forceUnlock: false });
    const service = new Service();
    await expect(service.releaseFailFast()).rejects.toThrow(KlockTimeoutException);
    expect(client.log.filter((entry) => entry.startsWith('forceUnlock'))).toHaveLength(1);
  });
});

describe('context wiring', () => {
  test('an externally supplied client is used and is not shut down by the context', async () => {
    const client = new FakeRedissonClient({ acquire: true, held: true, forceUnlock: true });
    const context = KlockConfiguration.create(client);
    expect(context.redissonClient).toBe(client);
    expect(context.lockFactory).toBeInstanceOf(LockFactory);
    expect(context.klockConfig.getDatabase()).toEqual(15);
    expect(getKlockAspectHandler()).toBe(context.klockAspectHandler);

    await context.shutdown();
    expect(client.shutdownCalls).toEqual(0);
    expect(() => getKlockAspectHandler()).toThrow('Klock is not configured');
  });

  test('KlockAutoConfiguration.create connects and later shuts down a client it created', async () => {
    const client = new FakeRedissonClient({ acquire: true, held: true, forceUnlock: true });
    const context = await KlockAutoConfiguration.create(new KlockConfig(), client);
    expect(context.redissonClient).toBe(client);
    // A supplied client stands in for @ConditionalOnMissingBean: it is not connected here.
    expect(client.log).toEqual([]);
    await context.shutdown();
    expect(client.shutdownCalls).toEqual(0);
  });

  test('the individual factory methods build the same collaborators', () => {
    const client = new FakeRedissonClient({ acquire: true, held: true, forceUnlock: true });
    const config = new KlockConfig();
    const businessKeyProvider = KlockAutoConfiguration.businessKeyProvider();
    expect(businessKeyProvider).toBeInstanceOf(BusinessKeyProvider);
    expect(KlockAutoConfiguration.lockInfoProvider(config, businessKeyProvider)).toBeInstanceOf(
      LockInfoProvider,
    );
    expect(KlockAutoConfiguration.lockFactory(client)).toBeInstanceOf(LockFactory);
    expect(KlockConfiguration.businessKeyProvider()).toBeInstanceOf(BusinessKeyProvider);
    expect(
      KlockConfiguration.lockInfoProvider(config, businessKeyProvider),
    ).toBeInstanceOf(LockInfoProvider);
    expect(KlockConfiguration.lockFactory(client)).toBeInstanceOf(LockFactory);
    expect(KlockConfiguration.klockConfig()).toBeInstanceOf(KlockConfig);
  });

  test('redisson() builds a single-server client from spring.klock.address', async () => {
    const config = new KlockConfig();
    config.setAddress('redis://127.0.0.1:6399');
    const client = KlockAutoConfiguration.redisson(config);
    expect(client.getLock('lock.a').getName()).toEqual('lock.a');
    await client.shutdown();
  });

  test('redisson() builds a cluster client when clusterServer is configured', async () => {
    const config = new KlockConfig();
    const { ClusterServer } = await import('../src/config/klock-config.js');
    const cluster = new ClusterServer();
    cluster.setNodeAddresses(['redis://127.0.0.1:7000', 'redis://127.0.0.1:7001']);
    config.setClusterServer(cluster);
    const client = KlockAutoConfiguration.redisson(config);
    expect(client.getFairLock('lock.b').getName()).toEqual('lock.b');
    expect(client.getReadWriteLock('lock.c').readLock().getName()).toEqual('lock.c');
    await client.shutdown();
  });
});
