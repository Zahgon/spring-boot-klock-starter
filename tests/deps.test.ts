import { describe, expect, test } from 'vitest';

import { AnnotationKey, getDeclaredMethod, MethodInvocationJoinPoint } from '../src/deps/aspect.js';
import { addParameterAnnotation } from '../src/deps/aspect.js';
import {
  IllegalArgumentException,
  IllegalStateException,
  NullPointerException,
} from '../src/deps/java-lang.js';
import { format, Level, Logger, LoggerFactory, setLevel, setSink } from '../src/deps/logger.js';
import { isEmpty as isObjectEmpty, nullSafeToString } from '../src/deps/object-utils.js';
import { getParameterNames } from '../src/deps/parameter-name-discoverer.js';
import {
  MethodBasedEvaluationContext,
  SpelEvaluationException,
  SpelExpressionParser,
  SpelParseException,
  StandardEvaluationContext,
} from '../src/deps/spel.js';
import { collectionToDelimitedString, isEmpty } from '../src/deps/string-utils.js';
import { Thread, TimeUnit } from '../src/deps/thread.js';

/**
 * Behaviour the original got from Spring and SLF4J and this port now implements
 * itself, so it needs tests of its own.
 */
describe('ObjectUtils.nullSafeToString', () => {
  test('renders null as the four-character string "null"', () => {
    expect(nullSafeToString(null)).toEqual('null');
    expect(nullSafeToString(undefined)).toEqual('null');
  });

  test('returns a string unchanged', () => {
    expect(nullSafeToString('user1')).toEqual('user1');
  });

  test('renders numbers and booleans the way Java does', () => {
    expect(nullSafeToString(3)).toEqual('3');
    expect(nullSafeToString(true)).toEqual('true');
  });

  test('renders an array as {a, b}', () => {
    expect(nullSafeToString(['a', 'b'])).toEqual('{a, b}');
    expect(nullSafeToString([])).toEqual('{}');
    expect(nullSafeToString([1, null])).toEqual('{1, null}');
  });

  test('isEmpty covers null, empty string and empty array', () => {
    expect(isObjectEmpty(null)).toBe(true);
    expect(isObjectEmpty('')).toBe(true);
    expect(isObjectEmpty([])).toBe(true);
    expect(isObjectEmpty('#param')).toBe(false);
    expect(isObjectEmpty(0)).toBe(false);
  });
});

describe('StringUtils.collectionToDelimitedString', () => {
  test('prefixes every element, so two keys become -a-b', () => {
    expect(collectionToDelimitedString(['a', 'b'], '', '-', '')).toEqual('-a-b');
  });

  test('an empty collection yields an empty string', () => {
    expect(collectionToDelimitedString([], '', '-', '')).toEqual('');
  });

  test('honours delimiter and suffix', () => {
    expect(collectionToDelimitedString(['a', 'b'], ',', '[', ']')).toEqual('[a],[b]');
  });

  test('isEmpty matches Spring StringUtils.isEmpty for the values Klock passes', () => {
    expect(isEmpty('')).toBe(true);
    expect(isEmpty(null)).toBe(true);
    expect(isEmpty(undefined)).toBe(true);
    expect(isEmpty('customLockTimeout')).toBe(false);
  });
});

describe('SpEL subset', () => {
  const parser = new SpelExpressionParser();

  test('resolves a variable by parameter name', () => {
    const context = new MethodBasedEvaluationContext(null, ['userId', 'id'], ['user1', 7]);
    expect(parser.parseExpression('#userId').getValue(context)).toEqual('user1');
  });

  test('exposes positional aliases a0/p0 like Spring does', () => {
    const context = new MethodBasedEvaluationContext(null, ['userId'], ['user1', 7]);
    expect(parser.parseExpression('#a0').getValue(context)).toEqual('user1');
    expect(parser.parseExpression('#p1').getValue(context)).toEqual(7);
  });

  test('navigates a bean property through its getter', () => {
    class Bean {
      constructor(private readonly id: number) {}
      getName(): string {
        return 'bob';
      }
      getId(): number {
        return this.id;
      }
    }
    const context = new MethodBasedEvaluationContext(null, ['user'], [new Bean(3)]);
    expect(parser.parseExpression('#user.name').getValue(context)).toEqual('bob');
    expect(parser.parseExpression('#user.id').getValue(context)).toEqual(3);
  });

  test('navigates a plain property when there is no getter', () => {
    const context = new MethodBasedEvaluationContext(null, ['user'], [{ name: 'ann' }]);
    expect(parser.parseExpression('#user.name').getValue(context)).toEqual('ann');
  });

  test('resolves a bare identifier against the root object', () => {
    const context = new StandardEvaluationContext({ id: 42 });
    expect(parser.parseExpression('id').getValue(context)).toEqual(42);
  });

  test('supports literals and indexing', () => {
    const context = new StandardEvaluationContext(null);
    expect(parser.parseExpression("'abc'").getValue(context)).toEqual('abc');
    expect(parser.parseExpression('12').getValue(context)).toEqual(12);
    expect(parser.parseExpression('null').getValue(context)).toBeNull();
    expect(parser.parseExpression('true').getValue(context)).toBe(true);
    const indexed = new MethodBasedEvaluationContext(null, ['xs'], [['a', 'b']]);
    expect(parser.parseExpression('#xs[1]').getValue(indexed)).toEqual('b');
  });

  test('safe navigation yields null instead of throwing', () => {
    const context = new MethodBasedEvaluationContext(null, ['user'], [null]);
    expect(parser.parseExpression('#user?.name').getValue(context)).toBeNull();
  });

  test('an undefined variable is an evaluation error', () => {
    const context = new MethodBasedEvaluationContext(null, ['userId'], ['user1']);
    expect(() => parser.parseExpression('#missing').getValue(context)).toThrow(
      SpelEvaluationException,
    );
  });

  test('navigating into null is an evaluation error', () => {
    const context = new MethodBasedEvaluationContext(null, ['user'], [null]);
    expect(() => parser.parseExpression('#user.name').getValue(context)).toThrow(
      SpelEvaluationException,
    );
  });

  test('an unsupported construct is a parse error rather than silent undefined', () => {
    expect(() => parser.parseExpression('#a + #b')).toThrow(SpelParseException);
    expect(() => parser.parseExpression('@bean')).toThrow(SpelParseException);
    expect(() => parser.parseExpression('')).toThrow(SpelParseException);
    expect(() => parser.parseExpression('#')).toThrow(SpelParseException);
  });

  test('malformed indexing and string literals are parse errors', () => {
    expect(() => parser.parseExpression('#xs[0')).toThrow(SpelParseException);
    expect(() => parser.parseExpression("'unterminated")).toThrow(SpelParseException);
    expect(() => parser.parseExpression('#user.')).toThrow(SpelParseException);
  });

  test('a property that does not exist is an evaluation error', () => {
    const context = new MethodBasedEvaluationContext(null, ['user'], [{ name: 'ann' }]);
    expect(() => parser.parseExpression('#user.missing').getValue(context)).toThrow(
      SpelEvaluationException,
    );
  });

  test('indexing into null is an evaluation error', () => {
    const context = new MethodBasedEvaluationContext(null, ['xs'], [null]);
    expect(() => parser.parseExpression('#xs[0]').getValue(context)).toThrow(
      SpelEvaluationException,
    );
  });

  test('whitespace around an expression is ignored', () => {
    const context = new MethodBasedEvaluationContext(null, ['userId'], ['user1']);
    expect(parser.parseExpression('  #userId  ').getValue(context)).toEqual('user1');
  });
});

describe('DefaultParameterNameDiscoverer', () => {
  test('recovers the declared parameter names of a method', () => {
    class Sample {
      method(userId: string, id: number): string {
        return `${userId}:${id}`;
      }
    }
    expect(getParameterNames(Sample.prototype.method)).toEqual(['userId', 'id']);
  });

  test('handles defaults, rest parameters and no parameters', () => {
    expect(getParameterNames(function named(a = 1, ...rest: number[]) {
      return [a, rest];
    })).toEqual(['a', 'rest']);
    expect(getParameterNames(() => 1)).toEqual([]);
  });

  test('yields an empty slot for a destructured parameter so positions still line up', () => {
    expect(getParameterNames(({ a }: { a: number }, b: number) => [a, b])).toEqual(['', 'b']);
  });

  test('a single parameter written without parentheses is still recovered', () => {
    const arrow = new Function('return x => x') as () => (x: unknown) => unknown;
    expect(getParameterNames(arrow())).toEqual([]);
  });

  test('a comma inside a string default does not split the parameter list', () => {
    expect(getParameterNames(function withDefault(a = 'x,y', b = 1) {
      return [a, b];
    })).toEqual(['a', 'b']);
  });

  test('comments in the signature are ignored', () => {
    const fn = new Function('return function f(/* c1 */ a, // c2\n b) { return [a,b]; }') as
      () => (a: unknown, b: unknown) => unknown;
    expect(getParameterNames(fn())).toEqual(['a', 'b']);
  });
});

describe('SLF4J logger', () => {
  test('substitutes {} placeholders positionally', () => {
    expect(format('Lock({}) waited {}s', ['lock.a', 2])).toEqual('Lock(lock.a) waited 2s');
  });

  test('leaves a placeholder alone when no argument is left', () => {
    expect(format('a {} b {}', ['x'])).toEqual('a x b {}');
  });

  test('routes messages through the sink at the right level', () => {
    const lines: string[] = [];
    const previousSink = setSink((level, logger, message) => {
      lines.push(`${Level[level]} ${logger} ${message}`);
    });
    try {
      const logger: Logger = LoggerFactory.getLogger('T');
      logger.warn('Timeout while acquiring Lock({})', 'lock.a');
      logger.info('foo1 acquire lock');
      expect(lines).toEqual([
        'WARN T Timeout while acquiring Lock(lock.a)',
        'INFO T foo1 acquire lock',
      ]);
    } finally {
      setSink(previousSink);
    }
  });

  test('level filtering suppresses messages below the threshold', () => {
    const lines: string[] = [];
    const previousSink = setSink((_level, _logger, message) => {
      lines.push(message);
    });
    const previousLevel = setLevel(Level.ERROR);
    try {
      const logger = LoggerFactory.getLogger('T');
      expect(logger.isWarnEnabled()).toBe(false);
      expect(logger.isInfoEnabled()).toBe(false);
      logger.warn('suppressed');
      logger.info('suppressed');
      expect(lines).toEqual([]);
    } finally {
      setLevel(previousLevel);
      setSink(previousSink);
    }
  });
});

describe('Thread', () => {
  test('code outside any submitted task runs on the main thread', () => {
    expect(Thread.currentThread().getId()).toEqual(1);
    expect(Thread.currentThread().getName()).toEqual('main');
  });

  test('each new thread gets its own id, inherited by everything it awaits', async () => {
    const seen = await Promise.all([
      Thread.runInNewThread(async () => {
        await Thread.sleep(5);
        return Thread.currentThread().getId();
      }),
      Thread.runInNewThread(async () => Thread.currentThread().getId()),
    ]);
    expect(seen[0]).not.toEqual(seen[1]);
    expect(seen[0]).not.toEqual(1);
    expect(Thread.currentThread().getName()).toEqual('main');
  });

  test('TimeUnit converts to milliseconds and sleeps', async () => {
    expect(TimeUnit.SECONDS.toMillis(2)).toEqual(2000);
    expect(TimeUnit.MILLISECONDS.toMillis(2)).toEqual(2);
    const start = Date.now();
    await TimeUnit.MILLISECONDS.sleep(30);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
    await TimeUnit.SECONDS.sleep(0);
  });
});

describe('join point and reflective lookup', () => {
  class Sample {
    calls: unknown[][] = [];
    business(foo: string, bar: string): string {
      return `${foo}/${bar}`;
    }
    handler(foo: string, bar: string): string {
      this.calls.push([foo, bar]);
      return 'handled';
    }
    wrongArity(foo: string): string {
      return foo;
    }
  }

  test('exposes the signature the advice reads', () => {
    const target = new Sample();
    const joinPoint = new MethodInvocationJoinPoint(
      target,
      Sample.prototype,
      'business',
      Sample.prototype.business,
      ['a', 'b'],
    );
    expect(joinPoint.getTarget()).toBe(target);
    expect(joinPoint.getArgs()).toEqual(['a', 'b']);
    expect(joinPoint.getSignature().getName()).toEqual('business');
    expect(joinPoint.getSignature().getDeclaringTypeName()).toEqual('Sample');
    expect(joinPoint.getSignature().getMethod().getParameterCount()).toEqual(2);
    expect(joinPoint.getSignature().getMethod().getParameterNames()).toEqual(['foo', 'bar']);
    expect(joinPoint.getSignature().getParameters().map((p) => p.name)).toEqual(['foo', 'bar']);
  });

  test('proceed invokes the underlying method on the target', async () => {
    const target = new Sample();
    const joinPoint = new MethodInvocationJoinPoint(
      target,
      Sample.prototype,
      'business',
      Sample.prototype.business,
      ['a', 'b'],
    );
    await expect(joinPoint.proceed()).resolves.toEqual('a/b');
  });

  test('parameter annotations are found by index, including through a subclass', () => {
    const key = new AnnotationKey<{ value: string }>('Test');
    class Base {
      run(a: number, b: number): number {
        return a + b;
      }
    }
    class Derived extends Base {}
    addParameterAnnotation(Base.prototype, 'run', 1, key, { value: 'x' });
    const joinPoint = new MethodInvocationJoinPoint(
      new Derived(),
      Derived.prototype,
      'run',
      Base.prototype.run,
      [1, 2],
    );
    const parameters = joinPoint.getSignature().getParameters();
    expect(parameters[0]?.getAnnotation(key)).toBeNull();
    expect(parameters[1]?.getAnnotation(key)).toEqual({ value: 'x' });
  });

  test('getDeclaredMethod requires the same parameter count', () => {
    const target = new Sample();
    expect(getDeclaredMethod(target, 'handler', 2)).toBe(Sample.prototype.handler);
    expect(getDeclaredMethod(target, 'wrongArity', 2)).toBeNull();
    expect(getDeclaredMethod(target, 'missing', 2)).toBeNull();
  });
});

describe('java.lang exception types', () => {
  test('each keeps its own identity and message', () => {
    const cause = new Error('root');
    const illegalArgument = new IllegalArgumentException('bad', cause);
    expect(illegalArgument).toBeInstanceOf(Error);
    expect(illegalArgument.name).toEqual('IllegalArgumentException');
    expect(illegalArgument.message).toEqual('bad');
    expect(illegalArgument.cause).toBe(cause);
    expect(new IllegalStateException('customReleaseTimeout').message).toEqual(
      'customReleaseTimeout',
    );
    expect(new NullPointerException()).toBeInstanceOf(NullPointerException);
    expect(new IllegalStateException('x')).not.toBeInstanceOf(IllegalArgumentException);
    // each type supports the no-cause and with-cause constructors
    expect(new IllegalArgumentException('a').cause).toBeUndefined();
    expect(new IllegalStateException('b').cause).toBeUndefined();
    expect(new IllegalStateException('b', cause).cause).toBe(cause);
    expect(new NullPointerException('c').cause).toBeUndefined();
    expect(new NullPointerException('c', cause).cause).toBe(cause);
    expect(new IllegalArgumentException().name).toEqual('IllegalArgumentException');
    expect(new IllegalStateException().name).toEqual('IllegalStateException');
  });
});
