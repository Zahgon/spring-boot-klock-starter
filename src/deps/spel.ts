/**
 * The Spring Expression Language subset the `@Klock` contract exposes.
 *
 * `@Klock(keys = {...})` entries are SpEL expressions evaluated against the
 * invocation, and `@KlockKey(value = ...)` entries are SpEL expressions evaluated
 * against the annotated argument. What the contract actually requires is
 * variable references (`#userId`), property navigation (`#user.name`), indexing,
 * and literals. This is a narrow evaluator for exactly that grammar — anything
 * outside it raises {@link SpelParseException} rather than silently evaluating
 * to `undefined`.
 */

export class SpelParseException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpelParseException';
  }
}

export class SpelEvaluationException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpelEvaluationException';
  }
}

/** Evaluation context: a root object plus named variables addressed with `#`. */
export class EvaluationContext {
  readonly variables = new Map<string, unknown>();

  constructor(readonly rootObject: unknown = null) {}

  setVariable(name: string, value: unknown): void {
    this.variables.set(name, value);
  }
}

/** `StandardEvaluationContext(root)` — property names resolve against `root`. */
export class StandardEvaluationContext extends EvaluationContext {}

/**
 * `MethodBasedEvaluationContext` — exposes each argument under its declared
 * parameter name and under the positional aliases `a0…aN` and `p0…pN`, with a
 * `null` root, exactly as Spring does for a method invocation.
 */
export class MethodBasedEvaluationContext extends EvaluationContext {
  constructor(rootObject: unknown, parameterNames: readonly string[], args: readonly unknown[]) {
    super(rootObject);
    for (let i = 0; i < args.length; i++) {
      const name = parameterNames[i];
      if (name) {
        this.setVariable(name, args[i]);
      }
      this.setVariable(`a${i}`, args[i]);
      this.setVariable(`p${i}`, args[i]);
    }
  }
}

interface Node {
  evaluate(context: EvaluationContext): unknown;
}

export class Expression {
  constructor(
    readonly expressionString: string,
    private readonly node: Node,
  ) {}

  getValue(context: EvaluationContext): unknown {
    return this.node.evaluate(context);
  }
}

export class SpelExpressionParser {
  parseExpression(expression: string): Expression {
    return new Expression(expression, new Parser(expression).parse());
  }
}

/**
 * Read a bean property the way Spring does: the JavaBean getter first
 * (`getName()` / `isName()`), then a plain property of the same name.
 */
function readProperty(target: unknown, name: string): unknown {
  if (target === null || target === undefined) {
    throw new SpelEvaluationException(
      `Property or field '${name}' cannot be found on null`,
    );
  }
  const holder = target as Record<string, unknown>;
  const suffix = name.charAt(0).toUpperCase() + name.slice(1);
  for (const accessor of [`get${suffix}`, `is${suffix}`]) {
    const candidate = holder[accessor];
    if (typeof candidate === 'function') {
      return (candidate as () => unknown).call(target);
    }
  }
  if (name in holder) {
    return holder[name];
  }
  throw new SpelEvaluationException(
    `Property or field '${name}' cannot be found on object of type '${typeof target}'`,
  );
}

const IDENTIFIER = /[A-Za-z_$][\w$]*/y;
const NUMBER = /-?\d+(\.\d+)?/y;

class Parser {
  private pos = 0;

  constructor(private readonly text: string) {}

  parse(): Node {
    const node = this.parseExpressionNode();
    this.skipWhitespace();
    if (this.pos < this.text.length) {
      throw new SpelParseException(
        `Unsupported SpEL construct at position ${this.pos} in "${this.text}"`,
      );
    }
    return node;
  }

  private parseExpressionNode(): Node {
    let node = this.parsePrimary();
    for (;;) {
      this.skipWhitespace();
      if (this.consume('?.')) {
        const name = this.readIdentifier();
        const target = node;
        node = {
          evaluate: (ctx) => {
            const value = target.evaluate(ctx);
            return value === null || value === undefined ? null : readProperty(value, name);
          },
        };
      } else if (this.consume('.')) {
        const name = this.readIdentifier();
        const target = node;
        node = { evaluate: (ctx) => readProperty(target.evaluate(ctx), name) };
      } else if (this.consume('[')) {
        const index = this.parseExpressionNode();
        this.skipWhitespace();
        if (!this.consume(']')) {
          throw new SpelParseException(`Missing ']' in "${this.text}"`);
        }
        const target = node;
        node = {
          evaluate: (ctx) => {
            const container = target.evaluate(ctx);
            const key = index.evaluate(ctx);
            if (container === null || container === undefined) {
              throw new SpelEvaluationException(`Cannot index into null in "${this.text}"`);
            }
            return (container as Record<string, unknown>)[String(key)];
          },
        };
      } else {
        return node;
      }
    }
  }

  private parsePrimary(): Node {
    this.skipWhitespace();
    if (this.consume('#')) {
      const name = this.readIdentifier();
      return {
        evaluate: (ctx) => {
          if (!ctx.variables.has(name)) {
            throw new SpelEvaluationException(`Variable '#${name}' is not defined`);
          }
          return ctx.variables.get(name);
        },
      };
    }
    if (this.peek() === "'" || this.peek() === '"') {
      const literal = this.readStringLiteral();
      return { evaluate: () => literal };
    }
    const number = this.match(NUMBER);
    if (number !== null) {
      const value = Number(number);
      return { evaluate: () => value };
    }
    const identifier = this.match(IDENTIFIER);
    if (identifier !== null) {
      if (identifier === 'null') {
        return { evaluate: () => null };
      }
      if (identifier === 'true' || identifier === 'false') {
        const value = identifier === 'true';
        return { evaluate: () => value };
      }
      return { evaluate: (ctx) => readProperty(ctx.rootObject, identifier) };
    }
    throw new SpelParseException(
      `Unsupported SpEL construct at position ${this.pos} in "${this.text}"`,
    );
  }

  private readStringLiteral(): string {
    const quote = this.text[this.pos];
    if (quote !== "'" && quote !== '"') {
      throw new SpelParseException(`Expected a string literal in "${this.text}"`);
    }
    this.pos++;
    let value = '';
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos] as string;
      if (ch === quote) {
        this.pos++;
        return value;
      }
      value += ch;
      this.pos++;
    }
    throw new SpelParseException(`Unterminated string literal in "${this.text}"`);
  }

  private readIdentifier(): string {
    const name = this.match(IDENTIFIER);
    if (name === null) {
      throw new SpelParseException(
        `Expected an identifier at position ${this.pos} in "${this.text}"`,
      );
    }
    return name;
  }

  private match(pattern: RegExp): string | null {
    pattern.lastIndex = this.pos;
    const result = pattern.exec(this.text);
    if (!result) {
      return null;
    }
    this.pos += result[0].length;
    return result[0];
  }

  private consume(token: string): boolean {
    if (this.text.startsWith(token, this.pos)) {
      this.pos += token.length;
      return true;
    }
    return false;
  }

  private peek(): string | undefined {
    return this.text[this.pos];
  }

  private skipWhitespace(): void {
    while (this.pos < this.text.length && /\s/.test(this.text[this.pos] as string)) {
      this.pos++;
    }
  }
}
