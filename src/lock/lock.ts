/**
 * Created by kl on 2017/12/29.
 *
 * Both operations are asynchronous here: in Java they block the calling thread
 * on a Redis round trip, and Node's equivalent of blocking on I/O is awaiting it.
 */
export interface Lock {
  acquire(): Promise<boolean>;

  release(): Promise<boolean>;
}
