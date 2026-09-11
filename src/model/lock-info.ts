import { LockType } from './lock-type.js';

/**
 * Created by kl on 2017/12/29.
 * Content: basic lock information.
 */
export class LockInfo {
  private type: LockType;
  private name: string;
  private waitTime: number;
  private leaseTime: number;

  constructor(
    type: LockType = LockType.Reentrant,
    name = '',
    waitTime = 0,
    leaseTime = 0,
  ) {
    this.type = type;
    this.name = name;
    this.waitTime = waitTime;
    this.leaseTime = leaseTime;
  }

  getName(): string {
    return this.name;
  }

  setName(name: string): void {
    this.name = name;
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

  getType(): LockType {
    return this.type;
  }

  setType(type: LockType): void {
    this.type = type;
  }

  toString(): string {
    return (
      'LockInfo{' +
      `type=${this.type}` +
      `, name='${this.name}'` +
      `, waitTime=${this.waitTime}` +
      `, leaseTime=${this.leaseTime}` +
      '}'
    );
  }
}
