/**
 * The `java.util.concurrent` types the ported suite uses.
 *
 * An `ExecutorService` submission is what makes a caller "another thread" in the
 * original, so each task here runs inside its own {@link Thread} context and is
 * therefore a distinct lock holder, with the pool size limiting how many run at
 * once.
 */

import { Thread } from '../../src/deps/thread.js';

export class CountDownLatch {
  private readonly waiters: Array<() => void> = [];

  constructor(private count: number) {}

  countDown(): void {
    if (this.count > 0) {
      this.count--;
    }
    if (this.count === 0) {
      for (const wake of this.waiters.splice(0)) {
        wake();
      }
    }
  }

  getCount(): number {
    return this.count;
  }

  await(): Promise<void> {
    if (this.count === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

export class ExecutorService {
  private running = 0;
  private readonly queue: Array<() => void> = [];
  private readonly inFlight = new Set<Promise<unknown>>();
  private shutdownRequested = false;

  constructor(private readonly nThreads: number) {}

  /** Submit a task; it starts as soon as a pool slot frees up. */
  submit<T>(task: () => Promise<T> | T): Promise<T> {
    const started = new Promise<T>((resolve, reject) => {
      const start = (): void => {
        this.running++;
        void Thread.runInNewThread(task)
          .then(resolve, reject)
          .finally(() => {
            this.running--;
            const next = this.queue.shift();
            if (next) {
              next();
            }
          });
      };
      if (this.running < this.nThreads) {
        start();
      } else {
        this.queue.push(start);
      }
    });
    const tracked = started.catch(() => undefined);
    this.inFlight.add(tracked);
    void tracked.finally(() => this.inFlight.delete(tracked));
    return started;
  }

  shutdown(): void {
    this.shutdownRequested = true;
  }

  /**
   * `awaitTermination`: returns true once the pool has been shut down and every
   * task has finished, false when `millis` elapses first — including the case
   * where `shutdown()` was never called.
   */
  async awaitTermination(millis: number): Promise<boolean> {
    const deadline = Date.now() + millis;
    for (;;) {
      if (this.shutdownRequested && this.running === 0 && this.queue.length === 0) {
        return true;
      }
      if (Date.now() >= deadline) {
        return false;
      }
      await Thread.sleep(Math.min(50, Math.max(1, deadline - Date.now())));
    }
  }
}

export const Executors = {
  newFixedThreadPool(nThreads: number): ExecutorService {
    return new ExecutorService(nThreads);
  },
};
