/**
 * Binding `spring.klock.*` properties onto {@link KlockConfig}.
 *
 * Spring Boot supplies this in the original: it reads `application.properties`,
 * relaxes property names so `spring.klock.address` can also be written
 * `SPRING_KLOCK_ADDRESS`, and ranks OS environment variables above the
 * properties file. All three behaviours are part of how the library is
 * configured, so the port implements them explicitly.
 */

import { ClusterServer, KlockConfig } from './klock-config.js';

export type PropertySource = Readonly<Record<string, string | undefined>>;

/** Parse the `key=value` subset of the `.properties` format Spring Boot accepts. */
export function parseProperties(text: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('!')) {
      continue;
    }
    const separator = line.search(/[=:]/);
    if (separator < 0) {
      properties[line] = '';
      continue;
    }
    properties[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return properties;
}

/** The environment-variable spelling of a canonical property name. */
export function toEnvironmentName(property: string): string {
  return property.replace(/[.-]/g, '_').toUpperCase();
}

/** Resolve one property, environment first, exactly as Spring Boot ranks them. */
export function resolveProperty(
  property: string,
  properties: PropertySource,
  environment: PropertySource,
): string | undefined {
  const fromEnvironment = environment[toEnvironmentName(property)];
  if (fromEnvironment !== undefined && fromEnvironment.length > 0) {
    return fromEnvironment;
  }
  return properties[property];
}

/**
 * `@ConditionalOnProperty(prefix = "spring.klock", name = "enable",
 * havingValue = "true", matchIfMissing = true)`.
 */
export function isKlockEnabled(
  properties: PropertySource,
  environment: PropertySource = process.env,
): boolean {
  const value = resolveProperty(`${KlockConfig.PREFIX}.enable`, properties, environment);
  return value === undefined ? true : value === 'true';
}

/** `@EnableConfigurationProperties(KlockConfig.class)` — bind the prefix onto a config object. */
export function bindKlockConfig(
  properties: PropertySource,
  environment: PropertySource = process.env,
): KlockConfig {
  const config = new KlockConfig();
  const read = (suffix: string): string | undefined =>
    resolveProperty(`${KlockConfig.PREFIX}.${suffix}`, properties, environment);

  const address = read('address');
  if (address !== undefined) {
    config.setAddress(address);
  }
  const password = read('password');
  if (password !== undefined) {
    config.setPassword(password);
  }
  const database = read('database');
  if (database !== undefined) {
    config.setDatabase(Number(database));
  }
  const waitTime = read('waitTime') ?? read('wait-time');
  if (waitTime !== undefined) {
    config.setWaitTime(Number(waitTime));
  }
  const leaseTime = read('leaseTime') ?? read('lease-time');
  if (leaseTime !== undefined) {
    config.setLeaseTime(Number(leaseTime));
  }
  const nodeAddresses = read('clusterServer.nodeAddresses') ?? read('cluster-server.node-addresses');
  if (nodeAddresses !== undefined && nodeAddresses.length > 0) {
    const clusterServer = new ClusterServer();
    clusterServer.setNodeAddresses(nodeAddresses.split(',').map((entry) => entry.trim()));
    config.setClusterServer(clusterServer);
  }
  return config;
}
