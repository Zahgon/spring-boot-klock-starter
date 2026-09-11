/**
 * The `java.lang` exception types the original throws directly.
 *
 * They are part of the observable surface — a caller distinguishes an
 * `IllegalStateException` raised by its own handler from a
 * `KlockTimeoutException` raised by the library — so they are reproduced as
 * distinct types rather than collapsed into `Error`.
 */

export class IllegalArgumentException extends Error {
  constructor(message?: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'IllegalArgumentException';
  }
}

export class IllegalStateException extends Error {
  constructor(message?: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'IllegalStateException';
  }
}

export class NullPointerException extends Error {
  constructor(message?: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'NullPointerException';
  }
}
