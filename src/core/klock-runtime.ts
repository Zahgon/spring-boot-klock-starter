import type { KlockAspectHandler } from './klock-aspect-handler.js';

/**
 * The aspect handler the `@Klock` decorator dispatches to.
 *
 * In the original, `KlockAspectHandler` is a singleton bean and Spring injects
 * it into the weaving infrastructure. TypeScript has no container, so the
 * configuration registers the singleton here and the decorator resolves it at
 * call time — late enough that a class can be decorated before the application
 * is configured, exactly as a Spring bean can be defined before the context
 * starts.
 */

let handler: KlockAspectHandler | null = null;

export function setKlockAspectHandler(next: KlockAspectHandler | null): void {
  handler = next;
}

export function getKlockAspectHandler(): KlockAspectHandler {
  if (!handler) {
    throw new Error(
      'Klock is not configured: build the context with KlockAutoConfiguration.create(...) ' +
        'or KlockConfiguration.create(...) before calling a @Klock method.',
    );
  }
  return handler;
}
