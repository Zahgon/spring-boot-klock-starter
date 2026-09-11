/**
 * Minimal SLF4J-compatible logger.
 *
 * Reproduces the two behaviours the original depends on: `{}` placeholder
 * substitution and level filtering via `isWarnEnabled()` / `isInfoEnabled()`.
 * It is deliberately not a general-purpose logging framework.
 */

export enum Level {
  ERROR = 40,
  WARN = 30,
  INFO = 20,
  DEBUG = 10,
}

export type LogSink = (level: Level, logger: string, message: string) => void;

const defaultSink: LogSink = (level, logger, message) => {
  const stamp = new Date().toISOString();
  const line = `${stamp} ${Level[level].padEnd(5)} ${logger} : ${message}`;
  if (level >= Level.WARN) {
    process.stderr.write(`${line}\n`);
  } else {
    process.stdout.write(`${line}\n`);
  }
};

let currentLevel: Level = Level.INFO;
let sink: LogSink = defaultSink;

/** Substitute SLF4J `{}` placeholders positionally; surplus arguments are ignored. */
export function format(pattern: string, args: readonly unknown[]): string {
  let index = 0;
  return pattern.replace(/\{}/g, () => (index < args.length ? String(args[index++]) : '{}'));
}

export class Logger {
  constructor(private readonly name: string) {}

  isWarnEnabled(): boolean {
    return currentLevel <= Level.WARN;
  }

  isInfoEnabled(): boolean {
    return currentLevel <= Level.INFO;
  }

  warn(pattern: string, ...args: unknown[]): void {
    if (this.isWarnEnabled()) {
      sink(Level.WARN, this.name, format(pattern, args));
    }
  }

  info(pattern: string, ...args: unknown[]): void {
    if (this.isInfoEnabled()) {
      sink(Level.INFO, this.name, format(pattern, args));
    }
  }
}

export class LoggerFactory {
  static getLogger(name: string): Logger {
    return new Logger(name);
  }
}

/** Test/host hook: change the threshold. Returns the previous level. */
export function setLevel(level: Level): Level {
  const previous = currentLevel;
  currentLevel = level;
  return previous;
}

/** Test/host hook: redirect output. Returns the previous sink. */
export function setSink(next: LogSink): LogSink {
  const previous = sink;
  sink = next;
  return previous;
}
