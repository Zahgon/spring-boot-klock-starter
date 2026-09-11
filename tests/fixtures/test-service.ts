import { Klock } from '../../src/annotation/klock.js';
import { KlockKey } from '../../src/annotation/klock-key.js';
import { LockTimeoutStrategy } from '../../src/model/lock-timeout-strategy.js';
import { TimeUnit } from '../../src/deps/thread.js';
import type { User } from './user.js';

/**
 * Created by kl on 2017/12/29.
 *
 * Java overloads `getValue` three times with a different `@Klock` on each.
 * TypeScript has no runtime overloading, so the three become three methods; the
 * arguments, the lock configuration and the return values are unchanged.
 */
export class TestService {
  @Klock({
    waitTime: 10,
    leaseTime: 60,
    keys: ['#param'],
    lockTimeoutStrategy: LockTimeoutStrategy.FAIL_FAST,
  })
  async getValue(param: string): Promise<string> {
    //  if ("sleep".equals(param)) { // sleeping or blocking on a breakpoint holds the lock
    await TimeUnit.SECONDS.sleep(3);
    //  }
    void param;
    return 'success';
  }

  @Klock({ keys: ['#userId'] })
  async getValueByUserId(userId: string, @KlockKey() id: number | null): Promise<string> {
    void userId;
    void id;
    await TimeUnit.SECONDS.sleep(60);
    return 'success';
  }

  @Klock({ keys: ['#user.name', '#user.id'] })
  async getValueByUser(user: User): Promise<string> {
    void user;
    await TimeUnit.SECONDS.sleep(60);
    return 'success';
  }
}
