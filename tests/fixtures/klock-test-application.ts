import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bindKlockConfig, isKlockEnabled, parseProperties } from '../../src/config/klock-properties.js';
import type { KlockContext } from '../../src/klock-auto-configuration.js';
import { KlockAutoConfiguration } from '../../src/klock-auto-configuration.js';
import { resolveRedisAddress } from '../support/redis-address.js';
import { TestService } from './test-service.js';
import { TimeoutService } from './timeout-service.js';

/**
 * Created by kl on 2017/12/31.
 *
 * The application the tests boot: it reads `application.properties`, builds the
 * klock context from it, and exposes the two services.
 */
export class KlockTestApplication {
  private constructor(
    readonly context: KlockContext,
    readonly testService: TestService,
    readonly timeoutService: TimeoutService,
  ) {}

  static async run(): Promise<KlockTestApplication> {
    const here = dirname(fileURLToPath(import.meta.url));
    const properties = parseProperties(
      readFileSync(join(here, '..', 'resources', 'application.properties'), 'utf8'),
    );
    if (!isKlockEnabled(properties)) {
      throw new Error('spring.klock.enable is not true');
    }
    const klockConfig = bindKlockConfig(properties);
    klockConfig.setAddress(await resolveRedisAddress(klockConfig.getAddress()));

    const context = await KlockAutoConfiguration.create(klockConfig);
    return new KlockTestApplication(context, new TestService(), new TimeoutService());
  }

  async close(): Promise<void> {
    await this.context.shutdown();
  }
}
