import { Cluster, Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

import { Config, createConnection, parseAddress, Redisson } from '../src/deps/redisson/index.js';
import type { RedissonClient } from '../src/deps/redisson/index.js';
import { LOCK_WATCHDOG_TIMEOUT_MS } from '../src/deps/redisson/redisson-lock.js';
import { Thread, TimeUnit } from '../src/deps/thread.js';
import { resolveRedisAddress } from './support/redis-address.js';

/**
 * The lock protocol used to be Redisson's; it is now this repository's own code,
 * so its wire encoding and its concurrency behaviour are asserted directly.
 */
const DATABASE = 15;

let address: string;
let client: RedissonClient;
let probe: Redis;

beforeAll(async () => {
  address = await resolveRedisAddress(process.env['SPRING_KLOCK_ADDRESS'] ?? null);
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
  const keys = await probe.keys('lock.test*');
  const companions = await probe.keys('*lock.test*');
  const all = [...new Set([...keys, ...companions])];
  if (all.length > 0) {
    await probe.del(...all);
  }
});

describe('RedissonLock wire encoding', () => {
  test('a held lock is a hash of <clientId>:<threadId> -> hold count, with the lease as TTL', async () => {
    const name = 'lock.test.encoding';
    const lock = client.getLock(name);
    expect(await lock.tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);

    expect(await probe.type(name)).toEqual('hash');
    const entries = await probe.hgetall(name);
    const fields = Object.keys(entries);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d+$/,
    );
    expect(entries[fields[0] as string]).toEqual('1');

    const ttl = await probe.pttl(name);
    expect(ttl).toBeGreaterThan(8000);
    expect(ttl).toBeLessThanOrEqual(10000);

    expect(await lock.forceUnlock()).toBe(true);
  });

  test('re-entering the same lock from the same thread increments the hold count', async () => {
    const name = 'lock.test.reentrant';
    const lock = client.getLock(name);
    expect(await lock.tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);
    expect(await lock.tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);

    const entries = await probe.hgetall(name);
    expect(Object.values(entries)).toEqual(['2']);

    // forceUnlock drops the key whatever the hold count is — this is what Klock calls.
    expect(await lock.forceUnlock()).toBe(true);
    expect(await probe.exists(name)).toEqual(0);
  });

  test('forceUnlock announces the release on the lock channel', async () => {
    const name = 'lock.test.channel';
    const lock = client.getLock(name);
    expect(await lock.tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);

    const { host, port } = parseAddress(address);
    const listener = new Redis({ host, port, db: DATABASE, maxRetriesPerRequest: null });
    const received = new Promise<{ channel: string; message: string }>((resolve) => {
      listener.on('message', (channel: string, message: string) =>
        resolve({ channel, message }),
      );
    });
    await listener.subscribe(`redisson_lock__channel:{${name}}`);

    expect(await lock.forceUnlock()).toBe(true);
    await expect(received).resolves.toEqual({
      channel: `redisson_lock__channel:{${name}}`,
      message: '0',
    });
    listener.disconnect();
  });

  test('forceUnlock on a lock that is already gone returns false', async () => {
    const lock = client.getLock('lock.test.absent');
    expect(await lock.forceUnlock()).toBe(false);
  });

  test('isHeldByCurrentThread is true only for the holding thread', async () => {
    const name = 'lock.test.held';
    const lock = client.getLock(name);
    expect(await lock.isHeldByCurrentThread()).toBe(false);
    expect(await lock.tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);
    expect(await lock.isHeldByCurrentThread()).toBe(true);

    const otherThreadView = await Thread.runInNewThread(() => lock.isHeldByCurrentThread());
    expect(otherThreadView).toBe(false);

    await lock.forceUnlock();
    expect(await lock.isHeldByCurrentThread()).toBe(false);
  });
});

describe('RedissonLock acquisition', () => {
  test('another thread cannot take a held lock and gives up after waitTime', async () => {
    const name = 'lock.test.contended';
    const holder = client.getLock(name);
    expect(await holder.tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);

    const start = Date.now();
    const acquired = await Thread.runInNewThread(() =>
      client.getLock(name).tryLock(1, 10, TimeUnit.SECONDS),
    );
    const elapsed = Date.now() - start;

    expect(acquired).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(900);
    await holder.forceUnlock();
  });

  test('a waiter is woken by the release rather than waiting out its timeout', async () => {
    const name = 'lock.test.wakeup';
    const holder = client.getLock(name);
    expect(await holder.tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);

    const start = Date.now();
    const waiter = Thread.runInNewThread(() =>
      client.getLock(name).tryLock(20, 10, TimeUnit.SECONDS),
    );

    await TimeUnit.MILLISECONDS.sleep(500);
    await holder.forceUnlock();

    expect(await waiter).toBe(true);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5000);
    await Thread.runInNewThread(() => client.getLock(name).forceUnlock());
  });

  test('a lock whose lease expires becomes available again', async () => {
    const name = 'lock.test.expiry';
    const holder = client.getLock(name);
    expect(await holder.tryLock(5, 1, TimeUnit.SECONDS)).toBe(true);
    await TimeUnit.MILLISECONDS.sleep(1200);

    expect(await probe.exists(name)).toEqual(0);
    expect(await holder.isHeldByCurrentThread()).toBe(false);
    expect(await Thread.runInNewThread(() => client.getLock(name).tryLock(1, 5, TimeUnit.SECONDS)))
      .toBe(true);
    await Thread.runInNewThread(() => client.getLock(name).forceUnlock());
  });
});

describe('watchdog', () => {
  test('leaseTime <= 0 takes the watchdog lease instead of an unbounded one', async () => {
    const name = 'lock.test.watchdog';
    const lock = client.getLock(name);
    expect(await lock.tryLock(5, -1, TimeUnit.SECONDS)).toBe(true);

    const ttl = await probe.pttl(name);
    expect(ttl).toBeGreaterThan(LOCK_WATCHDOG_TIMEOUT_MS - 2000);
    expect(ttl).toBeLessThanOrEqual(LOCK_WATCHDOG_TIMEOUT_MS);

    await lock.forceUnlock();
  });

  test('the watchdog keeps extending the lease while the lock is held', async () => {
    const name = 'lock.test.watchdog.renew';
    const lock = client.getLock(name);
    expect(await lock.tryLock(5, -1, TimeUnit.SECONDS)).toBe(true);

    // The renewal runs every internalLockLeaseTime / 3, i.e. every 10s.
    await TimeUnit.MILLISECONDS.sleep(11_500);
    const ttl = await probe.pttl(name);
    expect(ttl).toBeGreaterThan(LOCK_WATCHDOG_TIMEOUT_MS - 2000);

    await lock.forceUnlock();
    expect(await probe.exists(name)).toEqual(0);

    // Once released, nothing renews it any more.
    await TimeUnit.MILLISECONDS.sleep(200);
    expect(await probe.exists(name)).toEqual(0);
  }, 30_000);
});

describe('watchdog cancellation', () => {
  test('the watchdog stops once the lock is gone', async () => {
    const name = 'lock.test.watchdog.cancel';
    const lock = client.getLock(name);
    expect(await lock.tryLock(5, -1, TimeUnit.SECONDS)).toBe(true);

    // Something else removed the lock; the next renewal must notice and stand down
    // instead of resurrecting the key.
    await probe.del(name);
    await TimeUnit.MILLISECONDS.sleep(11_000);
    expect(await probe.exists(name)).toEqual(0);
    expect(await lock.isHeldByCurrentThread()).toBe(false);
  }, 30_000);
});

describe('RedissonFairLock', () => {
  test('waiters are served in arrival order', async () => {
    const name = 'lock.test.fair';
    const holder = client.getFairLock(name);
    expect(await holder.tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);

    const order: string[] = [];
    const contender = (label: string): Promise<void> =>
      Thread.runInNewThread(async () => {
        const lock = client.getFairLock(name);
        const acquired = await lock.tryLock(20, 2, TimeUnit.SECONDS);
        if (acquired) {
          order.push(label);
          await TimeUnit.MILLISECONDS.sleep(50);
          await lock.forceUnlock();
        }
      });

    const first = contender('first');
    await TimeUnit.MILLISECONDS.sleep(300);
    const second = contender('second');
    await TimeUnit.MILLISECONDS.sleep(300);
    const third = contender('third');
    await TimeUnit.MILLISECONDS.sleep(300);

    expect(await probe.llen(`redisson_lock_queue:{${name}}`)).toBeGreaterThan(0);

    await holder.forceUnlock();
    await Promise.all([first, second, third]);
    expect(order).toEqual(['first', 'second', 'third']);
  }, 40_000);

  test('a free fair lock is taken immediately and is reentrant', async () => {
    const name = 'lock.test.fair.free';
    const lock = client.getFairLock(name);
    expect(await lock.tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);
    expect(await lock.tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);
    expect(Object.values(await probe.hgetall(name))).toEqual(['2']);
    expect(await lock.isHeldByCurrentThread()).toBe(true);
    expect(await lock.forceUnlock()).toBe(true);
  });
});

describe('RedissonReadWriteLock', () => {
  test('several readers hold the lock at the same time', async () => {
    const name = 'lock.test.rw.read';
    const first = client.getReadWriteLock(name).readLock();
    expect(await first.tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);

    const secondAcquired = await Thread.runInNewThread(() =>
      client.getReadWriteLock(name).readLock().tryLock(2, 10, TimeUnit.SECONDS),
    );
    expect(secondAcquired).toBe(true);

    expect(await probe.hget(name, 'mode')).toEqual('read');
    const timeoutKeys = await probe.keys(`{${name}}:*:rwlock_timeout:*`);
    expect(timeoutKeys.length).toBeGreaterThanOrEqual(2);

    await first.forceUnlock();
  });

  test('a writer is excluded while a reader holds the lock', async () => {
    const name = 'lock.test.rw.exclusion';
    const reader = client.getReadWriteLock(name).readLock();
    expect(await reader.tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);

    const writerAcquired = await Thread.runInNewThread(() =>
      client.getReadWriteLock(name).writeLock().tryLock(1, 10, TimeUnit.SECONDS),
    );
    expect(writerAcquired).toBe(false);

    await reader.forceUnlock();
  });

  test('a write lock is exclusive, reentrant, and marks the mode', async () => {
    const name = 'lock.test.rw.write';
    const writer = client.getReadWriteLock(name).writeLock();
    expect(await writer.tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);
    expect(await probe.hget(name, 'mode')).toEqual('write');
    expect(await writer.isHeldByCurrentThread()).toBe(true);

    expect(await writer.tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);

    const otherWriter = await Thread.runInNewThread(() =>
      client.getReadWriteLock(name).writeLock().tryLock(1, 10, TimeUnit.SECONDS),
    );
    expect(otherWriter).toBe(false);

    const otherReader = await Thread.runInNewThread(() =>
      client.getReadWriteLock(name).readLock().tryLock(1, 10, TimeUnit.SECONDS),
    );
    expect(otherReader).toBe(false);

    expect(await writer.forceUnlock()).toBe(true);
    expect(await probe.exists(name)).toEqual(0);
  });

  test('the writing thread may also take the read lock', async () => {
    const name = 'lock.test.rw.downgrade';
    const readWriteLock = client.getReadWriteLock(name);
    expect(await readWriteLock.writeLock().tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);
    expect(await readWriteLock.readLock().tryLock(5, 10, TimeUnit.SECONDS)).toBe(true);
    expect(await readWriteLock.writeLock().forceUnlock()).toBe(true);
  });

  test('read and write locks use their own channel and lock name', () => {
    const readWriteLock = client.getReadWriteLock('lock.test.rw.name');
    expect(readWriteLock.readLock().getName()).toEqual('lock.test.rw.name');
    expect(readWriteLock.writeLock().getName()).toEqual('lock.test.rw.name');
  });
});

describe('Config and connection mapping', () => {
  test('parseAddress understands the address forms the configuration accepts', () => {
    expect(parseAddress('redis://127.0.0.1:6379')).toEqual({
      host: '127.0.0.1',
      port: 6379,
      tls: false,
    });
    expect(parseAddress('redis://redis')).toEqual({ host: 'redis', port: 6379, tls: false });
    expect(parseAddress('rediss://example.com:6380')).toEqual({
      host: 'example.com',
      port: 6380,
      tls: true,
    });
    expect(() => parseAddress('127.0.0.1:6379')).toThrow('Unsupported Redis address');
  });

  test('single-server configuration reaches the connection', () => {
    const config = new Config();
    config.useSingleServer().setAddress('redis://127.0.0.1:6390').setDatabase(7).setPassword('pw');
    const options = config.getServerOptions();
    expect(options).toEqual({
      kind: 'single',
      address: 'redis://127.0.0.1:6390',
      database: 7,
      password: 'pw',
    });

    const connection = createConnection(options) as Redis;
    expect(connection.options.host).toEqual('127.0.0.1');
    expect(connection.options.port).toEqual(6390);
    expect(connection.options.db).toEqual(7);
    expect(connection.options.password).toEqual('pw');
    connection.disconnect();
  });

  test('cluster configuration collects every node address', () => {
    const config = new Config();
    config
      .useClusterServers()
      .setPassword(null)
      .addNodeAddress('redis://127.0.0.1:7000', 'redis://127.0.0.1:7001');
    const options = config.getServerOptions();
    expect(options).toEqual({
      kind: 'cluster',
      nodeAddresses: ['redis://127.0.0.1:7000', 'redis://127.0.0.1:7001'],
      password: null,
    });

    const connection = createConnection(options);
    expect(connection).toBeInstanceOf(Cluster);
    expect((connection as Cluster).nodes()).toEqual([]);
    connection.disconnect();
  });

  test('a configuration with no server mode, or no address, is rejected', () => {
    expect(() => new Config().getServerOptions()).toThrow('No server mode configured');
    expect(() =>
      createConnection({ kind: 'single', address: null, database: 0, password: null }),
    ).toThrow('spring.klock.address is not configured');
  });
});
