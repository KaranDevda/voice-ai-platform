import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "./client";
import { reversePayment } from "./billing";
import { creditLedger, organizations, payments } from "./schema";
import { eq, sql } from "drizzle-orm";

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("gateway refunds and chargebacks take credit back", () => {
  const owner = createDb(ownerUrl ?? ""), app = createDb(appUrl ?? "");
  const tag = randomUUID().slice(0, 8);
  let orgId = "", pi1 = `pi_a_${tag}`, pi2 = `pi_b_${tag}`;
  const balance = async () => Number((await owner.db.select({ b: sql<string>`coalesce(sum(${creditLedger.deltaPaise}),0)` }).from(creditLedger).where(eq(creditLedger.orgId, orgId)))[0]!.b);

  beforeAll(async () => {
    const [o] = await owner.db.insert(organizations).values({ name: `Rev-${tag}` }).returning(); orgId = o!.id;
    // Two paid Stripe top-ups: $12.00 credited as Rs 1,000 and Rs 500 (rupee payment).
    const [a, b] = await owner.db.insert(payments).values([
      { orgId, gateway: "stripe", amountPaise: 100_000, currency: "USD", amountMinor: 1200, status: "paid", gatewayRef: `cs_a_${tag}`, gatewayPaymentId: pi1 },
      { orgId, gateway: "stripe", amountPaise: 50_000, currency: "INR", status: "paid", gatewayRef: `cs_b_${tag}`, gatewayPaymentId: pi2 },
    ]).returning();
    await owner.db.insert(creditLedger).values([{ orgId, deltaPaise: 100_000, reason: "topup", ref: a!.id, idempotencyKey: `payment:${a!.id}` }, { orgId, deltaPaise: 50_000, reason: "topup", ref: b!.id, idempotencyKey: `payment:${b!.id}` }]);
  });
  afterAll(async () => { await owner.pool.end(); await app.pool.end(); });

  it("a partial refund takes back its share, once, and a bigger refund only the difference", async () => {
    expect(await reversePayment(app.db, "stripe", pi1, 600, "cumulative", "ch_1")).toBe("reversed");
    expect(await balance()).toBe(150_000 - 50_000);
    expect(await reversePayment(app.db, "stripe", pi1, 600, "cumulative", "ch_1")).toBe("already");
    expect(await balance()).toBe(100_000);
    expect(await reversePayment(app.db, "stripe", pi1, 1200, "cumulative", "ch_1")).toBe("reversed");
    expect(await balance()).toBe(50_000);
    expect(await reversePayment(app.db, "stripe", pi1, 5000, "cumulative", "ch_1")).toBe("already");
    expect(await balance()).toBe(50_000);
  });
  it("a chargeback takes credit back once and never more than the payment credited", async () => {
    expect(await reversePayment(app.db, "stripe", pi2, 20_000, "add", "dp_1")).toBe("reversed");
    expect(await reversePayment(app.db, "stripe", pi2, 20_000, "add", "dp_1")).toBe("already"); // the same dispute delivered again
    expect(await reversePayment(app.db, "stripe", pi2, 20_000, "add", "dp_1b")).toBe("reversed"); // a second dispute of its own
    expect(await reversePayment(app.db, "stripe", pi2, 999_999, "add", "dp_2")).toBe("reversed"); // capped at what is left
    expect(await reversePayment(app.db, "stripe", pi2, 1, "add", "dp_3")).toBe("already");
    expect(await balance()).toBe(0);
  });
  it("ignores a payment it does not know", async () => {
    expect(await reversePayment(app.db, "stripe", "pi_nope", 100, "cumulative", "ch_x")).toBe("unknown");
  });
});
