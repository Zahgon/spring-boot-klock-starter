/**
 * Find the Redis the suite should run against.
 *
 * `tests/resources/application.properties` carries the address the upstream
 * project shipped — a LAN address that does not resolve anywhere else — so, just
 * as the Java suite has to be pointed at a reachable server before it can run,
 * this picks the first candidate that answers `PING`: the configured address
 * first, then the usual local ones. It never changes what the tests assert; it
 * only decides where they connect.
 */

import { createConnection } from 'node:net';

const FALLBACK_ADDRESSES = [
  'redis://127.0.0.1:6379',
  'redis://host.docker.internal:6379',
  'redis://redis:6379',
];

function ping(address: string, timeoutMs = 1500): Promise<boolean> {
  const match = /^rediss?:\/\/(?:[^@]*@)?([^:/]+)(?::(\d+))?/.exec(address);
  if (!match) {
    return Promise.resolve(false);
  }
  const host = match[1] as string;
  const port = match[2] ? Number(match[2]) : 6379;

  return new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    const done = (result: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => done(false));
    socket.on('error', () => done(false));
    socket.on('connect', () => socket.write('PING\r\n'));
    socket.on('data', (chunk: Buffer) => done(chunk.toString().startsWith('+PONG')));
  });
}

export async function resolveRedisAddress(configured: string | null): Promise<string> {
  const candidates = [configured, ...FALLBACK_ADDRESSES].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0,
  );
  for (const candidate of candidates) {
    if (await ping(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `No reachable Redis. Tried: ${candidates.join(', ')}. ` +
      'Start one (docker run -p 6379:6379 redis:7-alpine) or set SPRING_KLOCK_ADDRESS.',
  );
}
