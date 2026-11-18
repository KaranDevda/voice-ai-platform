import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, ROLE_PERMISSIONS, type AuthUser } from "@voiceai/auth";
import { createDb } from "./client";
import { listCountryRates } from "./billing";
import { applyMargins, deleteCarrierCost, listCarrierCosts, PricingError, saveCarrierCost } from "./pricing";
import { organizations, users } from "./schema";

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("carrier costs, margins and applying them", () => {
  const owner = createDb(ownerUrl ?? ""), app = createDb(appUrl ?? "");
  let orgId = "", userId = "";
  const staff = (): AuthUser => ({ id: userId, orgId, teamIds: [], permissions: [...ROLE_PERMISSIONS.super_admin] });
  const plain = (): AuthUser => ({ id: userId, orgId, teamIds: [], permissions: [...ROLE_PERMISSIONS.agent] });

  beforeAll(async () => { const [o] = await owner.db.insert(organizations).values({ name: `Pricing-${randomUUID().slice(0, 8)}` }).returning(); orgId = o!.id; const [u] = await owner.db.insert(users).values({ orgId, email: `p-${randomUUID().slice(0, 8)}@x.io`, passwordHash: "x" }).returning(); userId = u!.id; });
  afterAll(async () => { await deleteCarrierCost(app.db, staff(), "ZZ").catch(() => {}); await owner.pool.end(); await app.pool.end(); });

  it("works out the selling price as cost plus margin", async () => {
    const r = await saveCarrierCost(app.db, staff(), { country: "zz", callCostPerMinPaise: 100, smsCostPaise: 33, marginPct: 25 });
    expect(r).toMatchObject({ country: "ZZ", callPricePaise: 125, smsPricePaise: 42 });
    expect((await listCarrierCosts(app.db, staff())).find((c) => c.country === "ZZ")).toMatchObject({ callPricePaise: 125, marginPct: 25 });
  });
  it("applies the prices to an organisation's country rates", async () => {
    const out = await applyMargins(app.db, staff(), orgId);
    expect(out.applied).toBeGreaterThanOrEqual(1);
    expect((await listCountryRates(app.db, staff())).find((c) => c.country === "ZZ")).toMatchObject({ callPerMinPaise: 125, smsPaise: 42 });
  });
  it("refuses a bad country or margin, and non-staff", async () => {
    await expect(saveCarrierCost(app.db, staff(), { country: "INDIA", callCostPerMinPaise: 1, smsCostPaise: 1, marginPct: 1 })).rejects.toBeInstanceOf(PricingError);
    await expect(saveCarrierCost(app.db, staff(), { country: "ZZ", callCostPerMinPaise: 1, smsCostPaise: 1, marginPct: 5000 })).rejects.toBeInstanceOf(PricingError);
    await expect(saveCarrierCost(app.db, plain(), { country: "ZZ", callCostPerMinPaise: 1, smsCostPaise: 1, marginPct: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(applyMargins(app.db, plain(), orgId)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
