/**
 * `Redisson` / `RedissonClient` — the entry point the original's
 * auto-configuration builds from a `Config`.
 *
 * `ioredis` supplies the connection, the RESP protocol and cluster routing;
 * every lock semantic on top of it lives in this package.
 */

import { randomUUID } from 'node:crypto';
import { Cluster, Redis } from 'ioredis';

import type { Config, ServerOptions } from './config.js';
import { parseAddress } from './config.js';
import { LockPubSub } from './lock-pub-sub.js';
import type { RedisConnection } from './redis-connection.js';
import type { RLock } from './redisson-lock.js';
import { RedissonLock } from './redisson-lock.js';
import { RedissonFairLock } from './redisson-fair-lock.js';
import type { RReadWriteLock } from './redisson-read-write-lock.js';
import { RedissonReadWriteLock } from './redisson-read-write-lock.js';

export interface RedissonClient {
  getLock(name: string): RLock;
  getFairLock(name: string): RLock;
  getReadWriteLock(name: string): RReadWriteLock;
  /** Open the connection. Java's `Redisson.create` connects eagerly; Node cannot do I/O in a constructor. */
  connect(): Promise<void>;
  shutdown(): Promise<void>;
}

type IoRedisClient = Redis | Cluster;

/** Translate a Redisson `Config` into the equivalent `ioredis` client. */
export function createConnection(options: ServerOptions): IoRedisClient {
  if (options.kind === 'cluster') {
    const nodes = options.nodeAddresses.map((address) => {
      const { host, port } = parseAddress(address);
      return { host, port };
    });
    return new Cluster(nodes, {
      lazyConnect: true,
      redisOptions: options.password === null ? {} : { password: options.password },
    });
  }
  if (!options.address) {
    throw new Error('spring.klock.address is not configured');
  }
  const { host, port, tls } = parseAddress(options.address);
  return new Redis({
    host,
    port,
    db: options.database,
    lazyConnect: true,
    maxRetriesPerRequest: null,
    ...(options.password === null ? {} : { password: options.password }),
    ...(tls ? { tls: {} } : {}),
  });
}

class RedissonClientImpl implements RedissonClient {
  private readonly clientId = randomUUID();
  private readonly pubSub: LockPubSub;

  constructor(
    private readonly connection: IoRedisClient,
    private readonly options: ServerOptions,
  ) {
    this.pubSub = new LockPubSub(() => this.createSubscriberConnection());
  }

  private get commands(): RedisConnection {
    return this.connection as unknown as RedisConnection;
  }

  private createSubscriberConnection(): RedisConnection {
    // A connection in subscriber mode cannot issue ordinary commands, so the
    // pub/sub side always gets its own.
    const subscriber = createConnection(this.options);
    void subscriber.connect().catch(() => undefined);
    return subscriber as unknown as RedisConnection;
  }

  getLock(name: string): RLock {
    return new RedissonLock(this.commands, this.pubSub, name, this.clientId);
  }

  getFairLock(name: string): RLock {
    return new RedissonFairLock(this.commands, this.pubSub, name, this.clientId);
  }

  getReadWriteLock(name: string): RReadWriteLock {
    return new RedissonReadWriteLock(this.commands, this.pubSub, name, this.clientId);
  }

  async connect(): Promise<void> {
    await this.connection.connect();
  }

  async shutdown(): Promise<void> {
    await this.pubSub.shutdown();
    this.connection.disconnect();
  }
}

export class Redisson {
  static create(config: Config): RedissonClient {
    const options = config.getServerOptions();
    return new RedissonClientImpl(createConnection(options), options);
  }
}
