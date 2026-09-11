/**
 * @author wanglaomo
 * @since 2019/4/16
 */
export class KlockInvocationException extends Error {
  constructor(message?: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'KlockInvocationException';
  }
}
