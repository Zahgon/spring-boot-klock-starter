/**
 * The AspectJ join-point surface the original's advice is written against, plus
 * the annotation metadata a decorator has to record for itself.
 *
 * Spring AOP gives the aspect a `JoinPoint` describing the intercepted call and
 * orders `@Around`, `@AfterReturning` and `@AfterThrowing` as *nested*
 * interceptors, with `@Around` outermost. That nesting is observable: when the
 * around advice returns without proceeding, the after-advice never runs. The
 * decorator in `annotation/klock.ts` reproduces the same nesting.
 */

import { getParameterNames } from './parameter-name-discoverer.js';

export type AnyMethod = (...args: never[]) => unknown;

export interface MethodHandle {
  getName(): string;
  /** Declared parameter count — the target-language stand-in for a parameter-type list. */
  getParameterCount(): number;
  getParameterNames(): string[];
}

export interface ParameterHandle {
  readonly index: number;
  readonly name: string;
  getAnnotation<T>(annotation: AnnotationKey<T>): T | null;
}

export interface MethodSignature {
  getName(): string;
  /** `signature.getDeclaringTypeName()` — see `truth.md` for why this is the class name. */
  getDeclaringTypeName(): string;
  getMethod(): MethodHandle;
  getParameters(): ParameterHandle[];
}

export interface JoinPoint {
  getTarget(): object;
  getArgs(): unknown[];
  getSignature(): MethodSignature;
}

export interface ProceedingJoinPoint extends JoinPoint {
  proceed(): Promise<unknown>;
}

/** A typed key under which a parameter annotation is stored. */
export class AnnotationKey<T> {
  constructor(readonly name: string) {}
  /** Present so the type parameter is used structurally rather than erased. */
  declare readonly annotationType?: T;
}

type ParameterAnnotations = Map<number, unknown>;

const parameterAnnotations = new WeakMap<object, Map<string, ParameterAnnotations>>();

/** Record a parameter annotation, as `@KlockKey` does at class-definition time. */
export function addParameterAnnotation<T>(
  prototype: object,
  propertyKey: string,
  index: number,
  key: AnnotationKey<T>,
  value: T,
): void {
  let byMethod = parameterAnnotations.get(prototype);
  if (!byMethod) {
    byMethod = new Map();
    parameterAnnotations.set(prototype, byMethod);
  }
  const slot = `${propertyKey}#${key.name}`;
  let byIndex = byMethod.get(slot);
  if (!byIndex) {
    byIndex = new Map();
    byMethod.set(slot, byIndex);
  }
  byIndex.set(index, value);
}

function findParameterAnnotation<T>(
  prototype: object,
  propertyKey: string,
  index: number,
  key: AnnotationKey<T>,
): T | null {
  const slot = `${propertyKey}#${key.name}`;
  let current: object | null = prototype;
  while (current) {
    const value = parameterAnnotations.get(current)?.get(slot)?.get(index);
    if (value !== undefined) {
      return value as T;
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return null;
}

class MethodHandleImpl implements MethodHandle {
  constructor(
    private readonly methodName: string,
    private readonly method: AnyMethod,
  ) {}

  getName(): string {
    return this.methodName;
  }

  getParameterCount(): number {
    return this.method.length;
  }

  getParameterNames(): string[] {
    return getParameterNames(this.method);
  }
}

class MethodSignatureImpl implements MethodSignature {
  private readonly handle: MethodHandle;

  constructor(
    private readonly declaringType: string,
    private readonly prototype: object,
    private readonly methodName: string,
    method: AnyMethod,
  ) {
    this.handle = new MethodHandleImpl(methodName, method);
  }

  getName(): string {
    return this.methodName;
  }

  getDeclaringTypeName(): string {
    return this.declaringType;
  }

  getMethod(): MethodHandle {
    return this.handle;
  }

  getParameters(): ParameterHandle[] {
    const names = this.handle.getParameterNames();
    const count = Math.max(this.handle.getParameterCount(), names.length);
    const prototype = this.prototype;
    const methodName = this.methodName;
    return Array.from({ length: count }, (_unused, index) => ({
      index,
      name: names[index] ?? '',
      getAnnotation: <T,>(annotation: AnnotationKey<T>): T | null =>
        findParameterAnnotation(prototype, methodName, index, annotation),
    }));
  }
}

/** The join point handed to the advice for one intercepted invocation. */
export class MethodInvocationJoinPoint implements ProceedingJoinPoint {
  private readonly signature: MethodSignature;

  constructor(
    private readonly target: object,
    prototype: object,
    methodName: string,
    private readonly method: AnyMethod,
    private readonly args: unknown[],
  ) {
    const declaringType = (target.constructor as { name?: string } | undefined)?.name ?? '';
    this.signature = new MethodSignatureImpl(declaringType, prototype, methodName, method);
  }

  getTarget(): object {
    return this.target;
  }

  getArgs(): unknown[] {
    return this.args;
  }

  getSignature(): MethodSignature {
    return this.signature;
  }

  async proceed(): Promise<unknown> {
    return await (this.method as (...args: unknown[]) => unknown).apply(this.target, this.args);
  }
}

/**
 * `Class.getDeclaredMethod(name, parameterTypes)`: the method must be declared
 * on the target's own class — inherited methods do not qualify — and must take
 * the same number of parameters as the intercepted method, which is this
 * language's stand-in for "the same parameter types". Returns `null` when there
 * is no such method, mirroring `NoSuchMethodException`.
 */
export function getDeclaredMethod(
  target: object,
  name: string,
  parameterCount: number,
): AnyMethod | null {
  const prototype = Object.getPrototypeOf(target) as object | null;
  if (!prototype) {
    return null;
  }
  const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
  const candidate = descriptor?.value as unknown;
  if (typeof candidate !== 'function') {
    return null;
  }
  const method = candidate as AnyMethod;
  return method.length === parameterCount ? method : null;
}
