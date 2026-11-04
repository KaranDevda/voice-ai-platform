import { sql } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { writeAudit } from "./audit";
import type { Db } from "./client";

export class ProfitError extends Error {}

export interface CarrierCosts { callPerMinPaise: number; smsPaise: number }

export async function getCarrierCosts(db: Db, actor: AuthUser): Promise<CarrierCosts> {
  assertAuthorized(actor, "platform.admin");
  const r = await db.execute<{ c: number; s: number }>(sql`select cost_call_per_min_paise as c, cost_sms_paise as s from platform_settings where id = 1`);
  return { callPerMinPaise: r.rows[0]?.c ?? 0, smsPaise: r.rows[0]?.s ?? 0 };
}

/** What the carrier charges the platform per started call minute and per text, in paise. Used only to estimate profit. */
export async function setCarrierCosts(db: Db, actor: AuthUser, costs: CarrierCosts) {
  assertAuthorized(actor, "platform.admin");
  for (const [what, v] of [["call cost", costs.callPerMinPaise], ["text cost", costs.smsPaise]] as const) if (!Number.isInteger(v) || v < 0 || v > 100_000) throw new ProfitError(`${what} must be a whole number of paise from 0 to 100000`);
  await db.transaction(async (tx) => {
    await tx.execute(sql`update platform_settings set cost_call_per_min_paise = ${costs.callPerMinPaise}, cost_sms_paise = ${costs.smsPaise}, updated_at = now() where id = 1`);
    await tx.execute(sql`select set_config('app.org_id', ${actor.orgId}, true)`);
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "platform.carrier_costs", entity: "platform_settings", after: costs });
  });
  return costs;
}

interface Bucket { revenuePaise: number; callMinutes: number; texts: number; costPaise: number; profitPaise: number }
const empty = (): Bucket => ({ revenuePaise: 0, callMinutes: 0, texts: 0, costPaise: 0, profitPaise: 0 });
const add = (b: Bucket, kind: string, amount: number, units: number, costs: CarrierCosts) => {
  b.revenuePaise += amount;
  if (kind === "call") { b.callMinutes += units; b.costPaise += units * costs.callPerMinPaise; } else { b.texts += units; b.costPaise += units * costs.smsPaise; }
  b.profitPaise = b.revenuePaise - b.costPaise;
};


export interface ProfitReport {
  days: number; costs: CarrierCosts; total: Bucket & { topupsPaise: number; balancePaise: number };
  byOrg: (Bucket & { orgId: string; orgName: string; topupsPaise: number; balancePaise: number })[];
  byCountry: (Bucket & { country: string })[];
  byDay: (Bucket & { day: string })[];
}

/**
 * What customers were charged (revenue), an estimate of what the carrier cost (minutes and texts times the cost rates in
 * platform settings), and the difference, by organisation, country (from the number dialled) and day. Platform staff only.
 */
export async function profitReport(db: Db, actor: AuthUser, days = 30): Promise<ProfitReport> {
  assertAuthorized(actor, "platform.admin");
  const d = Math.max(1, Math.min(366, Math.round(days)));
  const costs = await getCarrierCosts(db, actor);
  const usage = await db.execute<{ org_id: string; org_name: string; day: string; kind: string; country: string; amount_paise: string; units: string }>(sql`select * from platform_usage_rows(${d})`);
  const money = await db.execute<{ org_id: string; org_name: string; topups_paise: string; balance_paise: string }>(sql`select * from platform_money(${d})`);
  const orgs = new Map(money.rows.map((m) => [m.org_id, { orgId: m.org_id, orgName: m.org_name, topupsPaise: Number(m.topups_paise), balancePaise: Number(m.balance_paise), ...empty() }]));
  const country = new Map<string, Bucket & { country: string }>(), day = new Map<string, Bucket & { day: string }>(), total = empty();
  for (const r of usage.rows) {
    const amount = Number(r.amount_paise), units = Number(r.units), dayKey = typeof r.day === "string" ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10);
    const o = orgs.get(r.org_id);
    if (o) add(o, r.kind, amount, units, costs);
    const c = r.country; if (!country.has(c)) country.set(c, { country: c, ...empty() }); add(country.get(c)!, r.kind, amount, units, costs);
    if (!day.has(dayKey)) day.set(dayKey, { day: dayKey, ...empty() }); add(day.get(dayKey)!, r.kind, amount, units, costs);
    add(total, r.kind, amount, units, costs);
  }
  const byOrg = [...orgs.values()];
  return {
    days: d, costs,
    total: { ...total, topupsPaise: byOrg.reduce((a, o) => a + o.topupsPaise, 0), balancePaise: byOrg.reduce((a, o) => a + o.balancePaise, 0) },
    byOrg: byOrg.sort((a, b) => b.revenuePaise - a.revenuePaise),
    byCountry: [...country.values()].sort((a, b) => b.revenuePaise - a.revenuePaise),
    byDay: [...day.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
  };
}
