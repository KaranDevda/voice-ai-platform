/**
 * A fixed-window counter per key (for example an IP address). It lives in the memory of one server, so with several servers each
 * allows `limit` on its own. A limit shared across servers (a WAF rule or Redis) is not set up yet.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number, private readonly maxKeys = 10_000) {}

  /** Counts one request. `ok` is false once the key is over the limit; `retryAfterS` says when the window ends. */
  take(key: string, now = Date.now()): { ok: boolean; retryAfterS: number } {
    let h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      if (this.hits.size >= this.maxKeys) this.sweep(now);
      h = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, h);
    }
    h.count++;
    return { ok: h.count <= this.limit, retryAfterS: Math.max(1, Math.ceil((h.resetAt - now) / 1000)) };
  }

  /** Drops finished windows; if everything is still live, the oldest half goes, so memory stays bounded under a flood of addresses. */
  private sweep(now: number) {
    for (const [k, h] of this.hits) if (h.resetAt <= now) this.hits.delete(k);
    if (this.hits.size >= this.maxKeys) [...this.hits.keys()].slice(0, this.maxKeys >> 1).forEach((k) => this.hits.delete(k));
  }
}
