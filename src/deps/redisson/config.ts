/**
 * `org.redisson.config.Config` — only the surface the original's
 * auto-configuration touches.
 */

export interface SingleServerConfig {
  setAddress(address: string | null): SingleServerConfig;
  setDatabase(database: number): SingleServerConfig;
  setPassword(password: string | null): SingleServerConfig;
}

export interface ClusterServersConfig {
  setPassword(password: string | null): ClusterServersConfig;
  addNodeAddress(...addresses: string[]): ClusterServersConfig;
}

export interface SingleServerOptions {
  readonly kind: 'single';
  address: string | null;
  database: number;
  password: string | null;
}

export interface ClusterServerOptions {
  readonly kind: 'cluster';
  nodeAddresses: string[];
  password: string | null;
}

export type ServerOptions = SingleServerOptions | ClusterServerOptions;

export class Config {
  private options: ServerOptions | null = null;

  useSingleServer(): SingleServerConfig {
    const options: SingleServerOptions = {
      kind: 'single',
      address: null,
      database: 0,
      password: null,
    };
    this.options = options;
    const builder: SingleServerConfig = {
      setAddress(address) {
        options.address = address;
        return builder;
      },
      setDatabase(database) {
        options.database = database;
        return builder;
      },
      setPassword(password) {
        options.password = password;
        return builder;
      },
    };
    return builder;
  }

  useClusterServers(): ClusterServersConfig {
    const options: ClusterServerOptions = { kind: 'cluster', nodeAddresses: [], password: null };
    this.options = options;
    const builder: ClusterServersConfig = {
      setPassword(password) {
        options.password = password;
        return builder;
      },
      addNodeAddress(...addresses) {
        options.nodeAddresses.push(...addresses);
        return builder;
      },
    };
    return builder;
  }

  getServerOptions(): ServerOptions {
    if (!this.options) {
      throw new Error('No server mode configured: call useSingleServer() or useClusterServers()');
    }
    return this.options;
  }
}

/** Parse a `redis://host:port` / `rediss://host:port` address into its parts. */
export function parseAddress(address: string): { host: string; port: number; tls: boolean } {
  const match = /^(rediss?):\/\/(?:([^@]*)@)?([^:/]+)(?::(\d+))?/.exec(address);
  if (!match) {
    throw new Error(`Unsupported Redis address: ${address}`);
  }
  return {
    host: match[3] as string,
    port: match[4] ? Number(match[4]) : 6379,
    tls: match[1] === 'rediss',
  };
}
