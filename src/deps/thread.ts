import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * `Thread.currentThread().getId()` for a runtime that has no threads.
 *
 * The original identifies a lock holder by the JVM thread that took it: the
 * aspect keys its bookkeeping map on the thread id, and Redisson writes
 * `<clientId>:<threadId>` into the lock hash. Node runs one thread, so the
 * equivalent unit of "an independent caller" is an asynchronous execution
 * context. Every task started through {@link Thread.runInNewThread} — which is
 * what an `ExecutorService` submission becomes — gets its own id, and everything
 * awaited inside it inherits that id, exactly as everything called from a Java
 * thread sees the same `currentThread()`.
 *
 * Code that never enters such a context runs on the main thread, matching a
 * JUnit test body executing on the JVM's main thread.
 */

const MAIN_THREAD_ID = 1;

const storage = new AsyncLocalStorage<number>();
let nextThreadId = MAIN_THREAD_ID + 1;

export interface ThreadHandle {
  getId(): number;
  getName(): string;
}

export class Thread {
  static currentThread(): ThreadHandle {
    const id = storage.getStore() ?? MAIN_THREAD_ID;
    return {
      getId: () => id,
      getName: () => (id === MAIN_THREAD_ID ? 'main' : `thread-${id}`),
    };
  }

  /** Run `body` as an independent "thread": its own id, inherited by everything it awaits. */
  static runInNewThread<T>(body: () => Promise<T> | T): Promise<T> {
    const id = nextThreadId++;
    return storage.run(id, async () => body());
  }

  /** `Thread.sleep` / `TimeUnit.*.sleep`. */
  static sleep(millis: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, millis);
    });
  }
}

/** The subset of `java.util.concurrent.TimeUnit` the original uses. */
export const TimeUnit = {
  MILLISECONDS: {
    toMillis: (value: number): number => value,
    sleep: (value: number): Promise<void> => Thread.sleep(value),
  },
  SECONDS: {
    toMillis: (value: number): number => value * 1000,
    sleep: (value: number): Promise<void> => Thread.sleep(value * 1000),
  },
} as const;
