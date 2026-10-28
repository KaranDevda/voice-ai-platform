import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limit";

describe("RateLimiter", () => {
  it("allows the limit, then refuses until the window ends", () => {
    const r = new RateLimiter(3, 60_000);
    expect([1, 2, 3].map(() => r.take("a", 0).ok)).toEqual([true, true, true]);
    const over = r.take("a", 10_000);
    expect(over.ok).toBe(false);
    expect(over.retryAfterS).toBe(50);
    expect(r.take("a", 60_000).ok).toBe(true);
  });

  it("counts each key on its own", () => {
    const r = new RateLimiter(1, 1000);
    expect(r.take("a", 0).ok).toBe(true);
    expect(r.take("b", 0).ok).toBe(true);
    expect(r.take("a", 1).ok).toBe(false);
  });

  it("stays bounded under many keys", () => {
    const r = new RateLimiter(1, 1000, 10);
    for (let i = 0; i < 100; i++) r.take(`k${i}`, 0);
    expect((r as unknown as { hits: Map<string, unknown> }).hits.size).toBeLessThanOrEqual(10);
  });
});
