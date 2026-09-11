import type { RedissonClient } from './deps/redisson/index.js';
import { KlockConfig } from './config/klock-config.js';
import { BusinessKeyProvider } from './core/business-key-provider.js';
import { LockInfoProvider } from './core/lock-info-provider.js';
import { LockFactory } from './lock/lock-factory.js';
import type { KlockContext } from './klock-auto-configuration.js';
import { buildContext } from './klock-auto-configuration.js';

/**
 * Created by kl on 2017/12/29.
 * Content: for projects that configure the Redis client themselves — the client
 * is supplied from outside instead of being built from `spring.klock.*`.
 */
export class KlockConfiguration {
  static lockInfoProvider(
    klockConfig: KlockConfig,
    businessKeyProvider: BusinessKeyProvider,
  ): LockInfoProvider {
    return new LockInfoProvider(klockConfig, businessKeyProvider);
  }

  static businessKeyProvider(): BusinessKeyProvider {
    return new BusinessKeyProvider();
  }

  static lockFactory(redissonClient: RedissonClient): LockFactory {
    return new LockFactory(redissonClient);
  }

  static klockConfig(): KlockConfig {
    return new KlockConfig();
  }

  /** Wire the graph around a client the application already owns. */
  static create(redissonClient: RedissonClient, klockConfig?: KlockConfig): KlockContext {
    return buildContext(klockConfig ?? KlockConfiguration.klockConfig(), redissonClient, false);
  }
}
