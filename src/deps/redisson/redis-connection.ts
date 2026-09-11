/**
 * The Redis commands the lock implementations need.
 *
 * Declaring them structurally keeps the locks independent of any particular
 * client: `ioredis`'s single-node and cluster clients both satisfy it, and a
 * test can satisfy it with a recording double.
 */

export interface RedisConnection {
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  hexists(key: string, field: string): Promise<number>;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  disconnect(): void;
}
