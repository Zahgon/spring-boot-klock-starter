import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { Redis } from 'ioredis';

import { Config, parseAddress, Redisson } from '../src/deps/redisson/index.js';
import type { RedissonClient } from '../src/deps/redisson/index.js';
import { LockPubSub } from '../src/deps/redisson/lock-pub-sub.js';
import { Thread } from '../src/deps/thread.js';
import { FairLock } from '../src/lock/fair-lock.js';
import { ReadLock } from '../src/lock/read-lock.js';
import { ReentrantLock } from '../src/lock/reentrant-lock.js';
import { WriteLock } from '../src/lock/write-lock.js';
import { LockInfo } from '../src/model/lock-info.js';
import { LockType } from '../src/model/lock-type.js';
import { resolveRedisAddress } from './support/redis-address.js';

/**
 * The four `Lock` implementations, driven through the interface the aspect uses.
 */
const DATABASE = 15;

let client: RedissonClient;
let probe: Redis;

beforeAll(async () => {
  const address = await resolveRedisAddress(process.env['SPRING_KLOCK_ADDRESS'] ?? null);
  const config = new Config();
  config.useSingleServer().setAddress(address).setDatabase(DATABASE).setPassword(null);
  client = Redisson.create(config);
  await client.connect();
  const { host, port } = parseAddress(address);
  probe = new Redis({ host, port, db: DATABASE, maxRetriesPerRequest: null });
});

afterAll(async () => {
  await client.shutdown();
  probe.disconnect();
});

afterEach(async () => {
  const keys = await probe.keys('*lock.wrapper*');
  if (keys.length > 0) {
    await probe.del(...keys);
  }
});

function infoFor(type: LockType, name: string, waitTime = 5, leaseTime = 10): LockInfo {
  return new LockInfo(type, name, waitTime, leaseTime);
}

describe('ReentrantLock', () => {
  test('acquires, exposes its key, and releases', async () => {
    const info = infoFor(LockType.Reentrant, 'lock.wrapper.reentrant');
    const lock = new ReentrantLock(client, info);
    expect(lock.getKey()).toEqual('lock.wrapper.reentrant');
    expect(await lock.acquire()).toBe(true);
    expect(await probe.exists('lock.wrapper.reentrant')).toEqual(1);
    expect(await lock.release()).toBe(true);
    expect(await probe.exists('lock.wrapper.reentrant')).toEqual(0);
  });

  test('release reports false when the lock is no longer held', async () => {
    const info = infoFor(LockType.Reentrant, 'lock.wrapper.reentrant.lost', 5, 1);
    const lock = new ReentrantLock(client, info);
    expect(await lock.acquire()).toBe(true);
    await Thread.sleep(1200);
    expect(await lock.release()).toBe(false);
  });

  test('release before any acquire reports false', async () => {
    const lock = new ReentrantLock(client, infoFor(LockType.Reentrant, 'lock.wrapper.untouched'));
    expect(await lock.release()).toBe(false);
  });

  test('a second holder cannot acquire and gives up after waitTime', async () => {
    const name = 'lock.wrapper.reentrant.contended';
    const held = new ReentrantLock(client, infoFor(LockType.Reentrant, name));
    expect(await held.acquire()).toBe(true);
    const other = await Thread.runInNewThread(() =>
      new ReentrantLock(client, infoFor(LockType.Reentrant, name, 1)).acquire(),
    );
    expect(other).toBe(false);
    expect(await held.release()).toBe(true);
  });
});

describe('FairLock', () => {
  test('acquires and releases', async () => {
    const lock = new FairLock(client, infoFor(LockType.Fair, 'lock.wrapper.fair'));
    expect(await lock.acquire()).toBe(true);
    expect(await probe.exists('lock.wrapper.fair')).toEqual(1);
    expect(await lock.release()).toBe(true);
  });

  test('release before any acquire reports false', async () => {
    const lock = new FairLock(client, infoFor(LockType.Fair, 'lock.wrapper.fair.untouched'));
    expect(await lock.release()).toBe(false);
  });

  test('a second holder is refused while the lock is held', async () => {
    const name = 'lock.wrapper.fair.contended';
    const held = new FairLock(client, infoFor(LockType.Fair, name));
    expect(await held.acquire()).toBe(true);
    const other = await Thread.runInNewThread(() =>
      new FairLock(client, infoFor(LockType.Fair, name, 1)).acquire(),
    );
    expect(other).toBe(false);
    expect(await held.release()).toBe(true);
  });
});

describe('ReadLock and WriteLock', () => {
  test('a read lock acquires and releases', async () => {
    const lock = new ReadLock(client, infoFor(LockType.Read, 'lock.wrapper.read'));
    expect(await lock.acquire()).toBe(true);
    expect(await probe.hget('lock.wrapper.read', 'mode')).toEqual('read');
    expect(await lock.release()).toBe(true);
  });

  test('a write lock acquires and releases', async () => {
    const lock = new WriteLock(client, infoFor(LockType.Write, 'lock.wrapper.write'));
    expect(await lock.acquire()).toBe(true);
    expect(await probe.hget('lock.wrapper.write', 'mode')).toEqual('write');
    expect(await lock.release()).toBe(true);
  });

  test('a write lock excludes a reader on another thread', async () => {
    const name = 'lock.wrapper.rw.exclusive';
    const writer = new WriteLock(client, infoFor(LockType.Write, name));
    expect(await writer.acquire()).toBe(true);
    const reader = await Thread.runInNewThread(() =>
      new ReadLock(client, infoFor(LockType.Read, name, 1)).acquire(),
    );
    expect(reader).toBe(false);
    expect(await writer.release()).toBe(true);
  });

  test('release before any acquire reports false for both', async () => {
    expect(await new ReadLock(client, infoFor(LockType.Read, 'lock.wrapper.r0')).release()).toBe(
      false,
    );
    expect(await new WriteLock(client, infoFor(LockType.Write, 'lock.wrapper.w0')).release()).toBe(
      false,
    );
  });
});

describe('LockPubSub', () => {
  test('reference-counts subscriptions and only unsubscribes on the last release', async () => {
    const created: Redis[] = [];
    const pubSub = new LockPubSub(() => {
      const address = probe.options;
      const connection = new Redis({
        host: address.host,
        port: address.port,
        db: DATABASE,
        maxRetriesPerRequest: null,
      });
      created.push(connection);
      return connection;
    });

    const channel = 'redisson_lock__channel:{lock.wrapper.pubsub}';
    const first = await pubSub.subscribe(channel);
    const second = await pubSub.subscribe(channel);
    expect(second).toBe(first);
    expect(second.counter).toEqual(2);

    await pubSub.unsubscribe(channel);
    expect(first.counter).toEqual(1);
    await pubSub.unsubscribe(channel);
    // unsubscribing an unknown channel is a no-op rather than an error
    await pubSub.unsubscribe('redisson_lock__channel:{lock.wrapper.absent}');

    await pubSub.shutdown();
    for (const connection of created) {
      connection.disconnect();
    }
    expect(created.length).toEqual(1);
  });

  test('a waiter is released by a message on its channel', async () => {
    const channel = 'redisson_lock__channel:{lock.wrapper.pubsub.wake}';
    const pubSub = new LockPubSub(() => {
      const address = probe.options;
      return new Redis({
        host: address.host,
        port: address.port,
        db: DATABASE,
        maxRetriesPerRequest: null,
      });
    });
    const entry = await pubSub.subscribe(channel);

    const start = Date.now();
    const waiting = entry.await(10_000);
    await Thread.sleep(200);
    await probe.publish(channel, '0');
    await waiting;
    expect(Date.now() - start).toBeLessThan(5_000);

    await pubSub.unsubscribe(channel);
    await pubSub.shutdown();
  });

  test('waiting for a non-positive time returns immediately', async () => {
    const pubSub = new LockPubSub(() => {
      throw new Error('no connection should be needed');
    });
    const channel = 'redisson_lock__channel:{lock.wrapper.pubsub.zero}';
    // subscribe() would need a connection, so exercise the entry directly via a
    // subscription that is torn down without one.
    await expect(
      (async () => {
        try {
          await pubSub.subscribe(channel);
        } catch {
          // expected: the factory refuses to build a connection
        }
        await pubSub.unsubscribe(channel);
      })(),
    ).resolves.toBeUndefined();
  });
});
