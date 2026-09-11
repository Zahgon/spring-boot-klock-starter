/**
 * Redisson's lock pub/sub: waiters subscribe to the lock's channel and are woken
 * by the message the releasing client publishes, instead of polling.
 */

import type { RedisConnection } from './redis-connection.js';

/** `LockPubSub.UNLOCK_MESSAGE` — published when a lock is released. */
export const UNLOCK_MESSAGE = '0';

class LockEntry {
  counter = 0;
  private waiters: Array<() => void> = [];

  /**
   * Wake everyone waiting on this channel. Redisson hands out one permit per
   * message; waking all waiters is observably equivalent because each one
   * re-attempts the atomic acquire script and at most one can win, and it cannot
   * strand a waiter if a message is lost.
   */
  release(): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const wake of pending) {
      wake();
    }
  }

  /** Wait for a release message, giving up after `millis`. */
  await(millis: number): Promise<void> {
    if (millis <= 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const index = this.waiters.indexOf(finish);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        resolve();
      };
      const timer = setTimeout(finish, millis);
      timer.unref?.();
      this.waiters.push(finish);
    });
  }
}

export class LockPubSub {
  private readonly entries = new Map<string, LockEntry>();
  private subscriber: RedisConnection | null = null;

  constructor(private readonly connectionFactory: () => RedisConnection) {}

  /** Subscribe to `channel`, reusing an existing subscription when one is live. */
  async subscribe(channel: string): Promise<LockEntry> {
    const existing = this.entries.get(channel);
    if (existing) {
      existing.counter++;
      return existing;
    }

    const entry = new LockEntry();
    entry.counter = 1;
    this.entries.set(channel, entry);

    if (!this.subscriber) {
      this.subscriber = this.connectionFactory();
      this.subscriber.on('message', (incoming: string) => {
        this.entries.get(incoming)?.release();
      });
      this.subscriber.on('error', () => {
        /* a dropped subscription degrades to the timeout path, never a crash */
      });
    }
    await this.subscriber.subscribe(channel);
    return entry;
  }

  /** Drop one reference to `channel`; unsubscribe once the last waiter leaves. */
  async unsubscribe(channel: string): Promise<void> {
    const entry = this.entries.get(channel);
    if (!entry) {
      return;
    }
    entry.counter--;
    if (entry.counter > 0) {
      return;
    }
    this.entries.delete(channel);
    if (this.subscriber) {
      await this.subscriber.unsubscribe(channel).catch(() => undefined);
    }
  }

  async shutdown(): Promise<void> {
    this.entries.clear();
    if (this.subscriber) {
      const subscriber = this.subscriber;
      this.subscriber = null;
      subscriber.disconnect();
    }
  }
}

export type { LockEntry };
