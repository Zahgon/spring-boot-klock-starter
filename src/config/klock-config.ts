/**
 * Created by kl on 2017/12/29.
 *
 * Configuration bound under the `spring.klock` prefix.
 */
export class ClusterServer {
  private nodeAddresses: string[] = [];

  getNodeAddresses(): string[] {
    return this.nodeAddresses;
  }

  setNodeAddresses(nodeAddresses: string[]): void {
    this.nodeAddresses = nodeAddresses;
  }
}

export class KlockConfig {
  static readonly PREFIX = 'spring.klock';

  // redisson
  private address: string | null = null;
  private password: string | null = null;
  private database = 15;
  private clusterServer: ClusterServer | null = null;
  private waitTime = 60;
  private leaseTime = 60;

  getAddress(): string | null {
    return this.address;
  }

  setAddress(address: string | null): void {
    this.address = address;
  }

  getPassword(): string | null {
    return this.password;
  }

  setPassword(password: string | null): void {
    this.password = password;
  }

  getWaitTime(): number {
    return this.waitTime;
  }

  setWaitTime(waitTime: number): void {
    this.waitTime = waitTime;
  }

  getLeaseTime(): number {
    return this.leaseTime;
  }

  setLeaseTime(leaseTime: number): void {
    this.leaseTime = leaseTime;
  }

  getDatabase(): number {
    return this.database;
  }

  setDatabase(database: number): void {
    this.database = database;
  }

  getClusterServer(): ClusterServer | null {
    return this.clusterServer;
  }

  setClusterServer(clusterServer: ClusterServer | null): void {
    this.clusterServer = clusterServer;
  }
}
