import { addParameterAnnotation, AnnotationKey } from '../deps/aspect.js';

/**
 * @author kl
 * @since 2018/1/24
 */
export interface KlockKeyAnnotation {
  /** A SpEL expression evaluated against the annotated argument; empty means "the argument itself". */
  value: string;
}

export const KLOCK_KEY = new AnnotationKey<KlockKeyAnnotation>('KlockKey');

/** Marks a parameter as contributing to the lock key. Applicable to parameters. */
export function KlockKey(value = ''): ParameterDecorator {
  return (target, propertyKey, parameterIndex) => {
    if (propertyKey === undefined) {
      throw new Error('@KlockKey is only supported on method parameters');
    }
    addParameterAnnotation(
      target as object,
      String(propertyKey),
      parameterIndex,
      KLOCK_KEY,
      { value },
    );
  };
}
