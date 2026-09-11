import { describe, expect, test, vi } from 'vitest';

import { LONG_MIN_VALUE, withDefaults } from '../src/annotation/klock.js';
import { ClusterServer, KlockConfig } from '../src/config/klock-config.js';
import {
  bindKlockConfig,
  isKlockEnabled,
  parseProperties,
  resolveProperty,
  toEnvironmentName,
} from '../src/config/klock-properties.js';
import { KlockInvocationException } from '../src/handler/klock-invocation-exception.js';
import { KlockTimeoutException } from '../src/handler/klock-timeout-exception.js';
import type { Lock } from '../src/lock/lock.js';
import { FairLock } from '../src/lock/fair-lock.js';
import { LockFactory } from '../src/lock/lock-factory.js';
import { ReadLock } from '../src/lock/read-lock.js';
import { ReentrantLock } from '../src/lock/reentrant-lock.js';
import { WriteLock } from '../src/lock/write-lock.js';
import { LockInfo } from '../src/model/lock-info.js';
import { LockTimeoutStrategy } from '../src/model/lock-timeout-strategy.js';
import { LockType } from '../src/model/lock-type.js';
import { ReleaseTimeoutStrategy } from '../src/model/release-timeout-strategy.js';
import type { RedissonClient } from '../src/deps/redisson/index.js';

const anyJoinPoint = {
  getTarget: () => ({}),
  getArgs: () => [],
  getSignature: () => {
    throw new Error('not used');
  },
};

describe('LockInfo', () => {
  test('carries type, name, waitTime and leaseTime through its accessors', () => {
    const info = new LockInfo(LockType.Fair, 'lock.a', 10, 60);
    expect(info.getType()).toEqual(LockType.Fair);
    expect(info.getName()).toEqual('lock.a');
    expect(info.getWaitTime()).toEqual(10);
    expect(info.getLeaseTime()).toEqual(60);

    info.setType(LockType.Read);
    info.setName('lock.b');
    info.setWaitTime(1);
    info.setLeaseTime(2);
    expect(info.getType()).toEqual(LockType.Read);
    expect(info.getName()).toEqual('lock.b');
    expect(info.getWaitTime()).toEqual(1);
    expect(info.getLeaseTime()).toEqual(2);
  });

  test('toString has the exact Java form', () => {
    expect(new LockInfo(LockType.Reentrant, 'lock.a', 10, 60).toString()).toEqual(
      "LockInfo{type=Reentrant, name='lock.a', waitTime=10, leaseTime=60}",
    );
  });

  test('a default-constructed LockInfo is a reentrant lock', () => {
    expect(new LockInfo().getType()).toEqual(LockType.Reentrant);
  });
});

describe('LockTimeoutStrategy', () => {
  const info = new LockInfo(LockType.Reentrant, 'lock.a', 2, 60);

  test('NO_OPERATION does nothing', async () => {
    const lock: Lock = { acquire: async () => false, release: async () => false };
    await expect(
      LockTimeoutStrategy.NO_OPERATION.handle(info, lock, anyJoinPoint),
    ).resolves.toBeUndefined();
  });

  test('FAIL_FAST throws KlockTimeoutException with the exact message', async () => {
    const lock: Lock = { acquire: async () => false, release: async () => false };
    await expect(LockTimeoutStrategy.FAIL_FAST.handle(info, lock, anyJoinPoint)).rejects.toThrow(
      'Failed to acquire Lock(lock.a) with timeout(2s)',
    );
    await expect(LockTimeoutStrategy.FAIL_FAST.handle(info, lock, anyJoinPoint)).rejects.toThrow(
      KlockTimeoutException,
    );
  });

  test('KEEP_ACQUIRE retries until the lock is acquired', async () => {
    let attempts = 0;
    const lock: Lock = {
      acquire: async () => {
        attempts++;
        return attempts >= 3;
      },
      release: async () => true,
    };
    await LockTimeoutStrategy.KEEP_ACQUIRE.handle(info, lock, anyJoinPoint);
    expect(attempts).toEqual(3);
  });

  test('KEEP_ACQUIRE gives up once the back-off passes three minutes', async () => {
    vi.useFakeTimers();
    try {
      const lock: Lock = { acquire: async () => false, release: async () => false };
      const pending = LockTimeoutStrategy.KEEP_ACQUIRE.handle(info, lock, anyJoinPoint);
      const assertion = expect(pending).rejects.toThrow(
        'Failed to acquire Lock(lock.a) after too many times, this may because dead lock occurs.',
      );
      // 100ms doubling: the eleventh sleep is 102400ms, the twelfth 204800ms > 180000ms.
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  test('the constants are enumerable and resolvable by name', () => {
    expect(LockTimeoutStrategy.values().map((value) => value.name())).toEqual([
      'NO_OPERATION',
      'FAIL_FAST',
      'KEEP_ACQUIRE',
    ]);
    expect(LockTimeoutStrategy.valueOf('FAIL_FAST')).toBe(LockTimeoutStrategy.FAIL_FAST);
    expect(String(LockTimeoutStrategy.KEEP_ACQUIRE)).toEqual('KEEP_ACQUIRE');
    expect(() => LockTimeoutStrategy.valueOf('NOPE')).toThrow(
      'No enum constant LockTimeoutStrategy.NOPE',
    );
  });
});

describe('ReleaseTimeoutStrategy', () => {
  const info = new LockInfo(LockType.Reentrant, 'lock.a', 10000, 1);

  test('NO_OPERATION does nothing', () => {
    expect(() => ReleaseTimeoutStrategy.NO_OPERATION.handle(info)).not.toThrow();
  });

  test('FAIL_FAST throws KlockTimeoutException with the exact message', () => {
    expect(() => ReleaseTimeoutStrategy.FAIL_FAST.handle(info)).toThrow(
      'Found Lock(lock.a) already been released while lock lease time is 1 s',
    );
    expect(() => ReleaseTimeoutStrategy.FAIL_FAST.handle(info)).toThrow(KlockTimeoutException);
  });

  test('the constants are enumerable and resolvable by name', () => {
    expect(ReleaseTimeoutStrategy.values().map((value) => value.name())).toEqual([
      'NO_OPERATION',
      'FAIL_FAST',
    ]);
    expect(ReleaseTimeoutStrategy.valueOf('NO_OPERATION')).toBe(
      ReleaseTimeoutStrategy.NO_OPERATION,
    );
    expect(String(ReleaseTimeoutStrategy.FAIL_FAST)).toEqual('FAIL_FAST');
    expect(() => ReleaseTimeoutStrategy.valueOf('NOPE')).toThrow(
      'No enum constant ReleaseTimeoutStrategy.NOPE',
    );
  });
});

describe('@Klock defaults', () => {
  test('an annotation with no members carries the declared defaults', () => {
    expect(withDefaults()).toEqual({
      name: '',
      lockType: LockType.Reentrant,
      waitTime: LONG_MIN_VALUE,
      leaseTime: LONG_MIN_VALUE,
      keys: [],
      lockTimeoutStrategy: LockTimeoutStrategy.NO_OPERATION,
      customLockTimeoutStrategy: '',
      releaseTimeoutStrategy: ReleaseTimeoutStrategy.NO_OPERATION,
      customReleaseTimeoutStrategy: '',
    });
  });

  test('LONG_MIN_VALUE is exactly Java Long.MIN_VALUE', () => {
    expect(LONG_MIN_VALUE).toEqual(-9223372036854775808);
  });

  test('supplied members win over the defaults', () => {
    const annotation = withDefaults({ name: 'foo-service', leaseTime: -1 });
    expect(annotation.name).toEqual('foo-service');
    expect(annotation.leaseTime).toEqual(-1);
    expect(annotation.waitTime).toEqual(LONG_MIN_VALUE);
  });
});

describe('LockFactory', () => {
  const client = {} as RedissonClient;
  const factory = new LockFactory(client);

  test('maps every lock type to its implementation', () => {
    expect(factory.getLock(new LockInfo(LockType.Reentrant, 'a', 1, 1))).toBeInstanceOf(
      ReentrantLock,
    );
    expect(factory.getLock(new LockInfo(LockType.Fair, 'a', 1, 1))).toBeInstanceOf(FairLock);
    expect(factory.getLock(new LockInfo(LockType.Read, 'a', 1, 1))).toBeInstanceOf(ReadLock);
    expect(factory.getLock(new LockInfo(LockType.Write, 'a', 1, 1))).toBeInstanceOf(WriteLock);
  });

  test('an unrecognised lock type falls back to the reentrant lock', () => {
    const info = new LockInfo(LockType.Reentrant, 'a', 1, 1);
    info.setType('Nope' as LockType);
    expect(factory.getLock(info)).toBeInstanceOf(ReentrantLock);
  });
});

describe('KlockConfig', () => {
  test('carries the documented defaults', () => {
    const config = new KlockConfig();
    expect(KlockConfig.PREFIX).toEqual('spring.klock');
    expect(config.getDatabase()).toEqual(15);
    expect(config.getWaitTime()).toEqual(60);
    expect(config.getLeaseTime()).toEqual(60);
    expect(config.getAddress()).toBeNull();
    expect(config.getPassword()).toBeNull();
    expect(config.getClusterServer()).toBeNull();
  });

  test('every property round-trips through its accessors', () => {
    const config = new KlockConfig();
    config.setAddress('redis://127.0.0.1:6379');
    config.setPassword('secret');
    config.setDatabase(3);
    config.setWaitTime(5);
    config.setLeaseTime(6);
    const cluster = new ClusterServer();
    cluster.setNodeAddresses(['redis://127.0.0.1:7000']);
    config.setClusterServer(cluster);

    expect(config.getAddress()).toEqual('redis://127.0.0.1:6379');
    expect(config.getPassword()).toEqual('secret');
    expect(config.getDatabase()).toEqual(3);
    expect(config.getWaitTime()).toEqual(5);
    expect(config.getLeaseTime()).toEqual(6);
    expect(config.getClusterServer()?.getNodeAddresses()).toEqual(['redis://127.0.0.1:7000']);
  });
});

describe('property binding', () => {
  test('parses the .properties subset Spring Boot accepts', () => {
    expect(
      parseProperties('# comment\n! bang\n\nspring.klock.address=redis://h:1\nspring.klock.database: 7\nflag\n'),
    ).toEqual({
      'spring.klock.address': 'redis://h:1',
      'spring.klock.database': '7',
      flag: '',
    });
  });

  test('relaxes a property name into its environment spelling', () => {
    expect(toEnvironmentName('spring.klock.address')).toEqual('SPRING_KLOCK_ADDRESS');
    expect(toEnvironmentName('spring.klock.cluster-server.node-addresses')).toEqual(
      'SPRING_KLOCK_CLUSTER_SERVER_NODE_ADDRESSES',
    );
  });

  test('the environment outranks application.properties', () => {
    const properties = { 'spring.klock.address': 'redis://from-file:6379' };
    expect(resolveProperty('spring.klock.address', properties, {})).toEqual(
      'redis://from-file:6379',
    );
    expect(
      resolveProperty('spring.klock.address', properties, {
        SPRING_KLOCK_ADDRESS: 'redis://from-env:6379',
      }),
    ).toEqual('redis://from-env:6379');
  });

  test('binds every supported property, in both spellings', () => {
    const config = bindKlockConfig(
      {
        'spring.klock.address': 'redis://h:1',
        'spring.klock.password': 'pw',
        'spring.klock.database': '4',
        'spring.klock.wait-time': '11',
        'spring.klock.leaseTime': '12',
        'spring.klock.cluster-server.node-addresses': 'redis://a:1, redis://b:2',
      },
      {},
    );
    expect(config.getAddress()).toEqual('redis://h:1');
    expect(config.getPassword()).toEqual('pw');
    expect(config.getDatabase()).toEqual(4);
    expect(config.getWaitTime()).toEqual(11);
    expect(config.getLeaseTime()).toEqual(12);
    expect(config.getClusterServer()?.getNodeAddresses()).toEqual(['redis://a:1', 'redis://b:2']);
  });

  test('an empty source leaves the defaults alone', () => {
    const config = bindKlockConfig({}, {});
    expect(config.getDatabase()).toEqual(15);
    expect(config.getWaitTime()).toEqual(60);
    expect(config.getClusterServer()).toBeNull();
  });

  test('klock is enabled unless the property says otherwise', () => {
    expect(isKlockEnabled({}, {})).toBe(true);
    expect(isKlockEnabled({ 'spring.klock.enable': 'true' }, {})).toBe(true);
    expect(isKlockEnabled({ 'spring.klock.enable': 'false' }, {})).toBe(false);
    expect(isKlockEnabled({}, { SPRING_KLOCK_ENABLE: 'false' })).toBe(false);
  });
});

describe('library exception types', () => {
  test('KlockTimeoutException and KlockInvocationException keep message and cause', () => {
    const cause = new Error('root');
    expect(new KlockTimeoutException().name).toEqual('KlockTimeoutException');
    expect(new KlockTimeoutException('m').message).toEqual('m');
    expect(new KlockTimeoutException('m', cause).cause).toBe(cause);
    expect(new KlockInvocationException().name).toEqual('KlockInvocationException');
    expect(
      new KlockInvocationException('Fail to invoke custom lock timeout handler: h', cause).message,
    ).toEqual('Fail to invoke custom lock timeout handler: h');
    expect(new KlockInvocationException('m', cause).cause).toBe(cause);
    expect(new KlockTimeoutException('m')).not.toBeInstanceOf(KlockInvocationException);
  });
});
