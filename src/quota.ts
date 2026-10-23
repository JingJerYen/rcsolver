/** Site-wide daily counter. Memory for Node and for a single Workers isolate; KV when a binding is present. */
export interface QuotaStore {
  /** Count one call for today; returns whether it fits under `limit` and the new total. */
  take(limit: number): Promise<{ allowed: boolean; used: number }>;
  /** Today's total without counting. */
  used(): Promise<number>;
}

export function todayKey(now = new Date()): string {
  return `calls:${now.toISOString().slice(0, 10)}`;
}

export class MemoryQuota implements QuotaStore {
  private key = "";
  private count = 0;

  private roll() {
    const k = todayKey();
    if (k !== this.key) {
      this.key = k;
      this.count = 0;
    }
  }

  async take(limit: number) {
    this.roll();
    if (limit > 0 && this.count >= limit) return { allowed: false, used: this.count };
    this.count++;
    return { allowed: true, used: this.count };
  }

  async used() {
    this.roll();
    return this.count;
  }
}

/** The subset of Cloudflare's KVNamespace this app uses. */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/** KV is eventually consistent, so this is a soft cap: a burst can overshoot by a few calls. */
export class KvQuota implements QuotaStore {
  constructor(private kv: KvLike) {}

  async take(limit: number) {
    const key = todayKey();
    const used = Number.parseInt((await this.kv.get(key)) ?? "0", 10) || 0;
    if (limit > 0 && used >= limit) return { allowed: false, used };
    await this.kv.put(key, String(used + 1), { expirationTtl: 2 * 86400 });
    return { allowed: true, used: used + 1 };
  }

  async used() {
    return Number.parseInt((await this.kv.get(todayKey())) ?? "0", 10) || 0;
  }
}
