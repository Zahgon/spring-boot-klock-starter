/**
 * Created by kl on 2017/12/29.
 * Content: lock type.
 */
export enum LockType {
  /** Reentrant lock. */
  Reentrant = 'Reentrant',
  /** Fair lock. */
  Fair = 'Fair',
  /** Read lock. */
  Read = 'Read',
  /** Write lock. */
  Write = 'Write',
}
