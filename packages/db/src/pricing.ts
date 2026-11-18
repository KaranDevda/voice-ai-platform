import { sql } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { MAX_MARGIN_PCT, priceWithMargin } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { ProfitError } from "./profit";
import { countryRates } from "./schema";

export class PricingError extends ProfitError {}

export interface CarrierCostRow { country: string; callCostPerMinPaise: number; smsCostPaise: number; marginPct: number; callPricePaise: number; smsPricePaise: number }

const cost = (v: unknown, what: string) => { if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100_000) throw new PricingError(`${what} must be a whole number of paise from 0 to 100000`); return v; };
const margin = (v: unknown) => { if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_MARGIN_PCT) throw new PricingError(`the margin must be from 0 to ${MAX_MARGIN_PCT} percent`); return Math.round(v * 100) / 100; };

/** The platform-wide default margin (percent): the starting value in the Pricing rules form. */
export async function getDefaultMargin(db: Db, actor: AuthUser): Promise<number> {
  assertAuthorized(actor, "platform.admin");
  const r = await db.execute<{ m: string }>(sql`select default_margin_pct as m from platform_settings where id = 1`);
  return Number(r.rows[0]?.m ?? 0);
}

export async function setDefaultMargin(db: Db, actor: AuthUser, marginPct: number) {
  assertAuthorized(actor, "platform.admin");
  const m = margin(marginPct);
  await db.transaction(async (tx) => {
    await tx.execute(sql`update platform_settings set default_margin_pct = ${m}, updated_at = now() where id = 1`);
    await tx.execute(sql`select set_config('app.org_id', ${actor.orgId}, true)`);
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "platform.default_margin", entity: "platform_settings", after: { marginPct: m } });
  });
  return m;
}

/** Each country's carrier cost, margin, and the selling price they work out to. Platform staff only. */
export async function listCarrierCosts(db: Db, actor: AuthUser): Promise<CarrierCostRow[]> {
  assertAuthorized(actor, "platform.admin");
  const r = await db.execute<{ country: string; c: number; s: number; m: string }>(sql`select country, call_cost_per_min_paise as c, sms_cost_paise as s, margin_pct as m from carrier_costs order by country`);
  return r.rows.map((x) => ({ country: x.country, callCostPerMinPaise: x.c, smsCostPaise: x.s, marginPct: Number(x.m), callPricePaise: priceWithMargin(x.c, Number(x.m)), smsPricePaise: priceWithMargin(x.s, Number(x.m)) }));
}

export async function saveCarrierCost(db: Db, actor: AuthUser, input: { country: string; callCostPerMinPaise: number; smsCostPaise: number; marginPct: number }) {
  assertAuthorized(actor, "platform.admin");
  const country = input.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new PricingError("the country must be a 2-letter code like IN");
  const c = cost(input.callCostPerMinPaise, "the call cost"), s = cost(input.smsCostPaise, "the text cost"), m = margin(input.marginPct);
  await db.transaction(async (tx) => {
    await tx.execute(sql`insert into carrier_costs (country, call_cost_per_min_paise, sms_cost_paise, margin_pct) values (${country}, ${c}, ${s}, ${m})
      on conflict (country) do update set call_cost_per_min_paise = excluded.call_cost_per_min_paise, sms_cost_paise = excluded.sms_cost_paise, margin_pct = excluded.margin_pct, updated_at = now()`);
    await tx.execute(sql`select set_config('app.org_id', ${actor.orgId}, true)`);
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "platform.carrier_cost", entity: "carrier_costs", after: { country, c, s, m } });
  });
  return { country, callCostPerMinPaise: c, smsCostPaise: s, marginPct: m, callPricePaise: priceWithMargin(c, m), smsPricePaise: priceWithMargin(s, m) };
}

export async function deleteCarrierCost(db: Db, actor: AuthUser, country: string) {
  assertAuthorized(actor, "platform.admin");
  const cc = country.trim().toUpperCase();
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from carrier_costs where country = ${cc}`);
    await tx.execute(sql`select set_config('app.org_id', ${actor.orgId}, true)`);
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "platform.carrier_cost_delete", entity: "carrier_costs", after: { country: cc } });
  });
}

/**
 * Sets one organisation's price for every country that has a carrier cost to cost plus margin, replacing any price it had for those
 * countries. Countries without a carrier cost are left alone. Platform staff only; audited against the target organisation.
 */
export async function applyMargins(db: Db, actor: AuthUser, orgId: string): Promise<{ applied: number; rows: { country: string; callPricePaise: number; smsPricePaise: number }[] }> {
  assertAuthorized(actor, "platform.admin");
  const rows = (await listCarrierCosts(db, actor)).map((r) => ({ country: r.country, callPricePaise: r.callPricePaise, smsPricePaise: r.smsPricePaise }));
  if (rows.length === 0) throw new PricingError("add carrier costs for at least one country first");
  if (rows.some((r) => r.callPricePaise > 100_000 || r.smsPricePaise > 100_000)) throw new PricingError("a price with this margin would be over Rs 1,000; lower the cost or margin");
  return withOrg(db, orgId, async (tx) => {
    await tx.insert(countryRates).values(rows.map((r) => ({ orgId, country: r.country, callPerMinPaise: r.callPricePaise, smsPaise: r.smsPricePaise })))
      .onConflictDoUpdate({ target: [countryRates.orgId, countryRates.country], set: { callPerMinPaise: sql`excluded.call_per_min_paise`, smsPaise: sql`excluded.sms_paise` } });
    await writeAudit(tx, { orgId, actorUserId: actor.id, action: "billing.apply_margins", entity: "country_rates", after: { countries: rows.length } });
    return { applied: rows.length, rows };
  });
}
