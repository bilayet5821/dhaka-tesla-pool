import { createHash } from 'node:crypto';

type Bucket = { count: number; until: number };

/** Single-process MVP throttle. Public hosting needs shared storage if API replicas are added. */
export class AuthThrottle {
  private readonly buckets = new Map<string, Bucket>();
  private readonly windowMs = 15 * 60 * 1000;

  constructor(private readonly now: () => number = Date.now) {}

  private consume(key: string, limit: number): boolean {
    const current = this.now();
    const old = this.buckets.get(key);
    const bucket = old && old.until > current ? old : { count: 0, until: current + this.windowMs };
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    this.buckets.set(key, bucket);
    if (this.buckets.size > 10000) {
      for (const [candidate, item] of this.buckets) {
        if (item.until <= current) this.buckets.delete(candidate);
      }
      if (this.buckets.size > 10000) this.buckets.delete(this.buckets.keys().next().value!);
    }
    return true;
  }

  allowRegister(ip: string): boolean {
    return this.consume(`register:${ip}`, 10);
  }

  allowLogin(ip: string, normalizedEmail: string): boolean {
    const identity = createHash('sha256').update(normalizedEmail).digest('hex');
    const accountKey = `login:${ip}:${identity}`;
    // Count both dimensions on every request, including a blocked one.
    const ipAllowed = this.consume(`login-ip:${ip}`, 30);
    const accountAllowed = this.consume(accountKey, 5);
    return ipAllowed && accountAllowed;
  }

  clearLogin(ip: string, normalizedEmail: string): void {
    const identity = createHash('sha256').update(normalizedEmail).digest('hex');
    this.buckets.delete(`login:${ip}:${identity}`);
  }
}
