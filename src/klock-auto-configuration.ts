import { Config, Redisson } from './deps/redisson/index.js';
import type { RedissonClient } from './deps/redisson/index.js';
import type { KlockConfig } from './config/klock-config.js';
import { BusinessKeyProvider } from './core/business-key-provider.js';
import { KlockAspectHandler } from './core/klock-aspect-handler.js';
import { LockInfoProvider } from './core/lock-info-provider.js';
import { setKlockAspectHandler } from './core/klock-runtime.js';
import { LockFactory } from './lock/lock-factory.js';

/**
 * @author kl
 * @since 2017/12/29
 * Content: klock auto-configuration.
 *
 * Spring Boot discovers this class through `META-INF/spring.factories` and wires
 * the beans itself. With no container to do that, the same object graph is built
 * explicitly by {@link KlockAutoConfiguration.create}, which also publishes the
 * aspect handler that the `@Klock` decorator dispatches to — the equivalent of
 * `@Import({KlockAspectHandler.class})`.
 */
export interface KlockContext {
  readonly klockConfig: KlockConfig;
  readonly redissonClient: RedissonClient;
  readonly lockInfoProvider: LockInfoProvider;
  readonly businessKeyProvider: BusinessKeyProvider;
  readonly lockFactory: LockFactory;
  readonly klockAspectHandler: KlockAspectHandler;
  /** `@Bean(destroyMethod = "shutdown")` — closes the client and unpublishes the handler. */
  shutdown(): Promise<void>;
}

export class KlockAutoConfiguration {
  /** `@Bean(destroyMethod = "shutdown") @ConditionalOnMissingBean RedissonClient redisson()`. */
  static redisson(klockConfig: KlockConfig): RedissonClient {
    const config = new Config();
    const clusterServer = klockConfig.getClusterServer();
    if (clusterServer !== null) {
      config
        .useClusterServers()
        .setPassword(klockConfig.getPassword())
        .addNodeAddress(...clusterServer.getNodeAddresses());
    } else {
      config
        .useSingleServer()
        .setAddress(klockConfig.getAddress())
        .setDatabase(klockConfig.getDatabase())
        .setPassword(klockConfig.getPassword());
    }
    return Redisson.create(config);
  }

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

  /**
   * Build and start the context. `redissonClient` stands in for
   * `@ConditionalOnMissingBean`: supply one and it is used as-is, omit it and
   * one is created from `klockConfig`.
   */
  static async create(
    klockConfig: KlockConfig,
    redissonClient?: RedissonClient,
  ): Promise<KlockContext> {
    const client = redissonClient ?? KlockAutoConfiguration.redisson(klockConfig);
    if (!redissonClient) {
      await client.connect();
    }
    return buildContext(klockConfig, client, redissonClient === undefined);
  }
}

/** Assemble the graph and publish the aspect handler. */
export function buildContext(
  klockConfig: KlockConfig,
  redissonClient: RedissonClient,
  ownsClient: boolean,
): KlockContext {
  const businessKeyProvider = KlockAutoConfiguration.businessKeyProvider();
  const lockInfoProvider = KlockAutoConfiguration.lockInfoProvider(klockConfig, businessKeyProvider);
  const lockFactory = KlockAutoConfiguration.lockFactory(redissonClient);
  const klockAspectHandler = new KlockAspectHandler(lockFactory, lockInfoProvider);
  setKlockAspectHandler(klockAspectHandler);

  return {
    klockConfig,
    redissonClient,
    lockInfoProvider,
    businessKeyProvider,
    lockFactory,
    klockAspectHandler,
    async shutdown(): Promise<void> {
      setKlockAspectHandler(null);
      if (ownsClient) {
        await redissonClient.shutdown();
      }
    },
  };
}
