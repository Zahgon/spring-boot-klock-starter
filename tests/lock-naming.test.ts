import { describe, expect, test } from 'vitest';

import { withDefaults } from '../src/annotation/klock.js';
import { KlockKey } from '../src/annotation/klock-key.js';
import { KlockConfig } from '../src/config/klock-config.js';
import { BusinessKeyProvider } from '../src/core/business-key-provider.js';
import { LockInfoProvider } from '../src/core/lock-info-provider.js';
import type { AnyMethod } from '../src/deps/aspect.js';
import { MethodInvocationJoinPoint } from '../src/deps/aspect.js';
import { Level, setSink } from '../src/deps/logger.js';
import { LockType } from '../src/model/lock-type.js';

/**
 * The lock-key format is the interoperability surface (`instruction.md` R1), so
 * it gets asserted directly rather than only through the end-to-end suite.
 */
class TestService {
  getValue(param: string): string {
    return param;
  }

  getValueByUserId(userId: string, @KlockKey() id: number | null): string {
    return `${userId}:${String(id)}`;
  }

  getValueByUser(user: { getName(): string | null; getId(): number }): string {
    return String(user.getId());
  }

  keyedByExpression(@KlockKey('id') user: { id: number }): number {
    return user.id;
  }
}

function joinPointFor(methodName: keyof TestService, args: unknown[]): MethodInvocationJoinPoint {
  const target = new TestService();
  return new MethodInvocationJoinPoint(
    target,
    TestService.prototype,
    methodName,
    TestService.prototype[methodName] as AnyMethod,
    args,
  );
}

function providerWith(config = new KlockConfig()): LockInfoProvider {
  return new LockInfoProvider(config, new BusinessKeyProvider());
}

describe('lock key naming', () => {
  test('with no name, the key is lock. + declaring type + . + method name', () => {
    const info = providerWith().get(joinPointFor('getValue', ['sleep']), withDefaults());
    expect(info.getName()).toEqual('lock.TestService.getValue');
  });

  test('an explicit name replaces the type and method entirely', () => {
    const info = providerWith().get(
      joinPointFor('getValue', ['sleep']),
      withDefaults({ name: 'foo-service' }),
    );
    expect(info.getName()).toEqual('lock.foo-service');
  });

  test('a SpEL key is appended with a leading separator', () => {
    const info = providerWith().get(
      joinPointFor('getValue', ['sleep']),
      withDefaults({ keys: ['#param'] }),
    );
    expect(info.getName()).toEqual('lock.TestService.getValue-sleep');
  });

  test('a @KlockKey parameter follows the SpEL keys, and null renders as "null"', () => {
    const info = providerWith().get(
      joinPointFor('getValueByUserId', ['user1', null]),
      withDefaults({ keys: ['#userId'] }),
    );
    expect(info.getName()).toEqual('lock.TestService.getValueByUserId-user1-null');
  });

  test('a @KlockKey parameter renders its value when it is not null', () => {
    const info = providerWith().get(
      joinPointFor('getValueByUserId', ['user1', 2]),
      withDefaults({ keys: ['#userId'] }),
    );
    expect(info.getName()).toEqual('lock.TestService.getValueByUserId-user1-2');
  });

  test('several SpEL keys are appended in declaration order', () => {
    const user = { getName: () => 'ann', getId: () => 3 };
    const info = providerWith().get(
      joinPointFor('getValueByUser', [user]),
      withDefaults({ keys: ['#user.name', '#user.id'] }),
    );
    expect(info.getName()).toEqual('lock.TestService.getValueByUser-ann-3');
  });

  test('a null property inside a SpEL key still renders as "null"', () => {
    const user = { getName: () => null, getId: () => 3 };
    const info = providerWith().get(
      joinPointFor('getValueByUser', [user]),
      withDefaults({ keys: ['#user.name', '#user.id'] }),
    );
    expect(info.getName()).toEqual('lock.TestService.getValueByUser-null-3');
  });

  test('@KlockKey with an expression evaluates it against the argument', () => {
    const info = providerWith().get(
      joinPointFor('keyedByExpression', [{ id: 9 }]),
      withDefaults(),
    );
    expect(info.getName()).toEqual('lock.TestService.keyedByExpression-9');
  });

  test('an empty key entry contributes nothing', () => {
    const info = providerWith().get(
      joinPointFor('getValue', ['sleep']),
      withDefaults({ keys: ['', '#param'] }),
    );
    expect(info.getName()).toEqual('lock.TestService.getValue-sleep');
  });
});

describe('wait and lease resolution', () => {
  test('unset wait and lease times fall back to the configuration', () => {
    const config = new KlockConfig();
    config.setWaitTime(30);
    config.setLeaseTime(45);
    const info = providerWith(config).get(joinPointFor('getValue', ['x']), withDefaults());
    expect(info.getWaitTime()).toEqual(30);
    expect(info.getLeaseTime()).toEqual(45);
  });

  test('annotation values win over the configuration', () => {
    const info = providerWith().get(
      joinPointFor('getValue', ['x']),
      withDefaults({ waitTime: 10, leaseTime: 60 }),
    );
    expect(info.getWaitTime()).toEqual(10);
    expect(info.getLeaseTime()).toEqual(60);
  });

  test('the lock type is carried through', () => {
    const info = providerWith().get(
      joinPointFor('getValue', ['x']),
      withDefaults({ lockType: LockType.Fair }),
    );
    expect(info.getType()).toEqual(LockType.Fair);
  });

  test('leaseTime -1 logs the no-expiration warning, with the lock name substituted', () => {
    const lines: string[] = [];
    const previousSink = setSink((level, logger, message) => {
      lines.push(`${Level[level]} ${logger} ${message}`);
    });
    try {
      providerWith().get(
        joinPointFor('getValue', ['x']),
        withDefaults({ name: 'foo-service', leaseTime: -1 }),
      );
    } finally {
      setSink(previousSink);
    }
    expect(lines).toEqual([
      'WARN LockInfoProvider Trying to acquire Lock(lock.foo-service) with no expiration, ' +
        'Klock will keep prolong the lock expiration while the lock is still holding by current thread. ' +
        'This may cause dead lock in some circumstances.',
    ]);
  });

  test('a finite lease time logs nothing', () => {
    const lines: string[] = [];
    const previousSink = setSink((_level, _logger, message) => {
      lines.push(message);
    });
    try {
      providerWith().get(joinPointFor('getValue', ['x']), withDefaults({ leaseTime: 60 }));
    } finally {
      setSink(previousSink);
    }
    expect(lines).toEqual([]);
  });
});
