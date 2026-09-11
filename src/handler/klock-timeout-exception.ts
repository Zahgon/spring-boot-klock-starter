/**
 * @author wanglaomo
 * @since 2019/4/16
 */
export class KlockTimeoutException extends Error {
  constructor(message?: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'KlockTimeoutException';
  }
}
