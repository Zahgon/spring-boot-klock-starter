import { describe, expect, test } from 'vitest';

import * as api from '../src/index.js';

/**
 * The package entry point must actually export the surface `instruction.md` R7
 * lists; a barrel that silently drops an export is a broken public API.
 */
describe('public API', () => {
  test('exports the annotations and their defaults', () => {
    expect(typeof api.Klock).toEqual('function');
    expect(typeof api.KlockKey).toEqual('function');
    expect(typeof api.withDefaults).toEqual('function');
    expect(api.LONG_MIN_VALUE).toEqual(-9223372036854775808);
    expect(api.KLOCK_KEY.name).toEqual('KlockKey');
  });

  test('exports the model types with their constants', () => {
    expect(api.LockType).toEqual({
      Reentrant: 'Reentrant',
      Fair: 'Fair',
      Read: 'Read',
      Write: 'Write',
    });
    expect(api.LockTimeoutStrategy.values()).toHaveLength(3);
    expect(api.ReleaseTimeoutStrategy.values()).toHaveLength(2);
    expect(new api.LockInfo().getType()).toEqual(api.LockType.Reentrant);
  });

  test('exports the lock implementations and the factory', () => {
    for (const name of ['LockFactory', 'ReentrantLock', 'FairLock', 'ReadLock', 'WriteLock']) {
      expect(typeof (api as unknown as Record<string, unknown>)[name]).toEqual('function');
    }
  });

  test('exports the configuration entry points', () => {
    expect(typeof api.KlockAutoConfiguration.create).toEqual('function');
    expect(typeof api.KlockConfiguration.create).toEqual('function');
    expect(typeof api.buildContext).toEqual('function');
    expect(api.KlockConfig.PREFIX).toEqual('spring.klock');
    expect(new api.ClusterServer().getNodeAddresses()).toEqual([]);
    expect(typeof api.bindKlockConfig).toEqual('function');
    expect(typeof api.parseProperties).toEqual('function');
    expect(typeof api.isKlockEnabled).toEqual('function');
    expect(typeof api.resolveProperty).toEqual('function');
    expect(api.toEnvironmentName('spring.klock.address')).toEqual('SPRING_KLOCK_ADDRESS');
  });

  test('exports the core collaborators and the runtime registry', () => {
    expect(typeof api.KlockAspectHandler).toEqual('function');
    expect(typeof api.LockInfoProvider).toEqual('function');
    expect(typeof api.BusinessKeyProvider).toEqual('function');
    expect(typeof api.setKlockAspectHandler).toEqual('function');
    expect(() => api.getKlockAspectHandler()).toThrow('Klock is not configured');
  });

  test('exports the exception types', () => {
    expect(new api.KlockTimeoutException('x')).toBeInstanceOf(Error);
    expect(new api.KlockInvocationException('x')).toBeInstanceOf(Error);
    expect(new api.IllegalArgumentException('x').name).toEqual('IllegalArgumentException');
    expect(new api.IllegalStateException('x').name).toEqual('IllegalStateException');
    expect(new api.NullPointerException('x').name).toEqual('NullPointerException');
  });

  test('exports the concurrency helpers and the Redis client factory', () => {
    expect(api.Thread.currentThread().getName()).toEqual('main');
    expect(api.TimeUnit.SECONDS.toMillis(2)).toEqual(2000);
    expect(typeof api.Redisson.create).toEqual('function');
  });
});
