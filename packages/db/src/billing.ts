import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { orgSettingsSchema, parseRates, type RateProblem } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { withOrg, type Db, type DbTx } from "./client";
import { countryRates, creditLedger, exchangeRates, LEDGER_REASONS as LEDGER_REASON_LIST, organizations, payments, users } from "./schema";

export class BillingError extends Error {}

export const MIN_TOPUP_PAISE = 10_000;      // Rs 100
export const MAX_TOPUP_PAISE = 10_000_000;  // Rs 1,00,000

const billingOf = async (tx: DbTx, orgId: string) => {
  const [org] = await tx.select({ s: organizations.settingsJson }).from(organizations).where(eq(organizations.id, orgId));
  return orgSettingsSchema.parse(org?.s ?? {}).billing;
};
const balanceOf = async (tx: DbTx, orgId: string) => Number((await tx.select({ b: sql<string>`coalesce(sum(${creditLedger.deltaPaise}), 0)` }).from(creditLedger).where(eq(creditLedger.orgId, orgId)))[0]!.b);

/** Refuses when the organisation has billing and "refuse at zero credit" both on and nothing is left. Call inside the same transaction as the work. */
export async function assertCredit(tx: DbTx, orgId: string) {
  const b = await billingOf(tx, orgId);
  if (b.enabled && b.enforce && (await balanceOf(tx, orgId)) <= 0) throw new BillingError("There is no credit left. Add credit on the Billing page.");
}

/** True when billing and "refuse at zero credit" are on and nothing is left (for the call check, which answers with a reason instead of throwing). */
export async function outOfCredit(tx: DbTx, orgId: string): Promise<boolean> {
  const b = await billingOf(tx, orgId);
  return b.enabled && b.enforce && (await balanceOf(tx, orgId)) <= 0;
}

/**
 * Charges a finished AI call: per started minute, once per call (a call saved twice is charged once), at the price for the country of the
 * number called (the organisation's price for that country, else its standard price). Does nothing when billing is off or the price is zero.
 */
export async function chargeCall(tx: DbTx, orgId: string, callLogId: string, durationS: number) {
  const b = await billingOf(tx, orgId);
  if (!b.enabled || durationS <= 0) return;
  const c = await tx.execute<{ country: string }>(sql`select coalesce(phone_country(l.phone_e164), 'other') as country from call_logs c left join leads l on l.id = c.lead_id where c.id = ${callLogId}::uuid`);
  const country = c.rows[0]?.country ?? "other";
  const rate = Number((await tx.execute<{ r: string | null }>(sql`select org_rate(${orgId}::uuid, ${country}, 'call') as r`)).rows[0]?.r ?? 0);
  if (rate <= 0) return;
  await tx.insert(creditLedger).values({ orgId, deltaPaise: -Math.ceil(durationS / 60) * rate, reason: "usage_call", ref: callLogId, idempotencyKey: `call:${callLogId}`, country }).onConflictDoNothing();
}

/** Balance, recent movements and top-ups, for the Billing page. */
export async function getBilling(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "org_settings.read");
  return withOrg(db, actor.orgId, async (tx) => ({
    balancePaise: await balanceOf(tx, actor.orgId),
    billing: await billingOf(tx, actor.orgId),
    ledger: await tx.select({ id: creditLedger.id, deltaPaise: creditLedger.deltaPaise, reason: creditLedger.reason, note: creditLedger.note, createdAt: creditLedger.createdAt }).from(creditLedger).orderBy(desc(creditLedger.createdAt)).limit(50),
    payments: await tx.select({ id: payments.id, gateway: payments.gateway, amountPaise: payments.amountPaise, currency: payments.currency, amountMinor: payments.amountMinor, status: payments.status, createdAt: payments.createdAt }).from(payments).orderBy(desc(payments.createdAt)).limit(20),
  }));
}

export type Gateway = "razorpay" | "stripe" | "paypal" | "paystack" | "flutterwave" | "cryptomus";
/** The currencies each gateway is offered in. Rupee gateways take rupees; the others need an exchange rate (set by platform staff). */
export const GATEWAY_CURRENCIES: Record<Gateway, readonly string[]> = { razorpay: ["INR"], stripe: ["INR", "USD", "EUR", "GBP"], paypal: ["USD", "EUR", "GBP"], paystack: ["NGN", "GHS", "ZAR", "USD"], flutterwave: ["USD", "NGN", "GHS", "KES", "ZAR"], cryptomus: ["USD"] };

/**
 * Records that a top-up is starting (not yet paid, not yet credited). The amount is in the gateway's currency (`amountMinor`: paise or cents);
 * what the organisation will be credited, in paise, is fixed now at the current exchange rate. Returns the payment, whose id goes to the gateway.
 */
export async function startTopup(db: Db, actor: AuthUser, input: { gateway: Gateway; currency: string; amountMinor: number }) {
  assertAuthorized(actor, "org_settings.write");
  const { gateway, amountMinor } = input, currency = input.currency.toUpperCase();
  if (!GATEWAY_CURRENCIES[gateway]?.includes(currency)) throw new BillingError(`${gateway} does not take ${currency} here`);
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new BillingError("enter an amount");
  return withOrg(db, actor.orgId, async (tx) => {
    let amountPaise = amountMinor;
    if (currency !== "INR") {
      const [rate] = await tx.select({ r: exchangeRates.paisePerUnit }).from(exchangeRates).where(eq(exchangeRates.currency, currency));
      if (!rate) throw new BillingError(`No exchange rate is set for ${currency}. Ask platform staff to set it.`);
      amountPaise = Math.round((amountMinor / 100) * Number(rate.r));
    }
    if (amountPaise < MIN_TOPUP_PAISE || amountPaise > MAX_TOPUP_PAISE) throw new BillingError("the amount must be worth between Rs 100 and Rs 1,00,000");
    const [p] = await tx.insert(payments).values({ orgId: actor.orgId, gateway, amountPaise, currency, amountMinor: currency === "INR" ? null : amountMinor, createdBy: actor.id }).returning({ id: payments.id });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "billing.topup_start", entity: "payments", entityId: p!.id, after: { gateway, currency, amountMinor, amountPaise } });
    return { id: p!.id, amountPaise, currency, amountMinor };
  });
}

export async function attachGatewayRef(db: Db, actor: AuthUser, paymentId: string, ref: string) {
  await withOrg(db, actor.orgId, (tx) => tx.update(payments).set({ gatewayRef: ref }).where(eq(payments.id, paymentId)));
}
export async function failTopup(db: Db, actor: AuthUser, paymentId: string) {
  await withOrg(db, actor.orgId, (tx) => tx.update(payments).set({ status: "failed" }).where(eq(payments.id, paymentId)));
}

export type PaymentOutcome = "credited" | "already" | "unknown" | "amount_mismatch" | "currency_mismatch";
/** The gateway said this payment succeeded (its webhook, after the signature was checked). Credits once, and only if the amount matches. */
export async function markPaymentPaid(db: Db, gateway: Gateway, gatewayRef: string, gatewayPaymentId: string | null, amountMinor: number | null, currency: string | null = null): Promise<PaymentOutcome> {
  const r = await db.execute<{ r: PaymentOutcome }>(sql`select payment_mark_paid(${gateway}, ${gatewayRef}, ${gatewayPaymentId}, ${amountMinor}::bigint, ${currency}) as r`);
  return r.rows[0]!.r;
}

export type ReversalOutcome = "reversed" | "already" | "unknown";
/**
 * A gateway took money back (refund or chargeback). Takes the matching credit back, once per event, never more than the payment credited.
 * `paymentRef` is the gateway's own payment id (kept when the payment was credited); `mode` "cumulative" = total refunded so far, "add" = one more amount.
 */
export async function reversePayment(db: Db, gateway: Gateway, paymentRef: string, amountMinor: number, mode: "cumulative" | "add", eventKey: string): Promise<ReversalOutcome> {
  const r = await db.execute<{ r: ReversalOutcome }>(sql`select payment_reverse(${gateway}, ${paymentRef}, ${amountMinor}::bigint, ${mode}, ${eventKey}) as r`);
  return r.rows[0]!.r;
}

/** A manual correction or refund by platform staff, for one organisation. A note is required. Positive adds credit, negative removes it. */
export async function adjustCredit(db: Db, actor: AuthUser, input: { orgId?: string; amountPaise: number; note: string; refund?: boolean }) {
  assertAuthorized(actor, "platform.admin");
  const note = input.note.normalize("NFC").trim();
  if (!note) throw new BillingError("write a note saying why");
  if (!Number.isInteger(input.amountPaise) || input.amountPaise === 0 || Math.abs(input.amountPaise) > MAX_TOPUP_PAISE) throw new BillingError("enter a non-zero amount in paise, up to Rs 1,00,000");
  const orgId = input.orgId ?? actor.orgId;
  return withOrg(db, orgId, async (tx) => {
    const [row] = await tx.insert(creditLedger).values({ orgId, deltaPaise: input.amountPaise, reason: input.refund ? "refund" : "adjustment", note: note.slice(0, 300), createdBy: actor.id }).returning({ id: creditLedger.id });
    await writeAudit(tx, { orgId, actorUserId: actor.id, action: "billing.adjust", entity: "credit_ledger", entityId: row!.id, after: { amountPaise: input.amountPaise, note } });
    return { id: row!.id, balancePaise: await balanceOf(tx, orgId) };
  });
}

// ------------------------------------------------------------------------------------------ prices by country

const price = (v: unknown, what: string) => { if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100_000) throw new BillingError(`${what} must be a whole number of paise from 0 to 100000`); return v; };

export async function listCountryRates(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "org_settings.read");
  return withOrg(db, actor.orgId, (tx) => tx.select({ country: countryRates.country, callPerMinPaise: countryRates.callPerMinPaise, smsPaise: countryRates.smsPaise }).from(countryRates).orderBy(countryRates.country));
}

export async function saveCountryRate(db: Db, actor: AuthUser, input: { country: string; callPerMinPaise: number; smsPaise: number }) {
  assertAuthorized(actor, "org_settings.write");
  const country = input.country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new BillingError("the country must be a 2-letter code like IN");
  const callPerMinPaise = price(input.callPerMinPaise, "the call price"), smsPaise = price(input.smsPaise, "the text price");
  return withOrg(db, actor.orgId, async (tx) => {
    await tx.insert(countryRates).values({ orgId: actor.orgId, country, callPerMinPaise, smsPaise }).onConflictDoUpdate({ target: [countryRates.orgId, countryRates.country], set: { callPerMinPaise, smsPaise } });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "billing.country_rate", entity: "country_rates", after: { country, callPerMinPaise, smsPaise } });
    return { country, callPerMinPaise, smsPaise };
  });
}

export async function deleteCountryRate(db: Db, actor: AuthUser, country: string) {
  assertAuthorized(actor, "org_settings.write");
  const c = country.trim().toUpperCase();
  return withOrg(db, actor.orgId, async (tx) => {
    const gone = await tx.delete(countryRates).where(eq(countryRates.country, c)).returning({ c: countryRates.country });
    if (!gone.length) throw new BillingError("there is no price for that country");
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "billing.country_rate_delete", entity: "country_rates", after: { country: c } });
    return { country: c };
  });
}

/** Adds or updates many countries' prices from a CSV (country, call_per_min_paise, sms_paise). Good rows are saved; bad rows are listed. */
export async function importCountryRates(db: Db, actor: AuthUser, text: string): Promise<{ saved: number; problems: RateProblem[] }> {
  assertAuthorized(actor, "org_settings.write");
  const { rows, problems } = parseRates(text);
  if (rows.length === 0) throw new BillingError(problems.length ? `no usable rows: ${problems[0]!.reason} (row ${problems[0]!.row})` : "no prices in the file");
  return withOrg(db, actor.orgId, async (tx) => {
    await tx.insert(countryRates).values(rows.map((r) => ({ orgId: actor.orgId, ...r, callPerMinPaise: r.callPerMinPaise, smsPaise: r.smsPaise })))
      .onConflictDoUpdate({ target: [countryRates.orgId, countryRates.country], set: { callPerMinPaise: sql`excluded.call_per_min_paise`, smsPaise: sql`excluded.sms_paise` } });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "billing.country_rate_import", entity: "country_rates", after: { saved: rows.length, invalid: problems.length } });
    return { saved: rows.length, problems: problems.slice(0, 30) };
  });
}

// ------------------------------------------------------------------------------------------ exchange rates

export async function listExchangeRates(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "org_settings.read");
  return (await db.select().from(exchangeRates).orderBy(exchangeRates.currency)).map((r) => ({ currency: r.currency, paisePerUnit: Number(r.paisePerUnit), updatedAt: r.updatedAt }));
}

/** Platform staff: how many paise one unit of a currency is worth (for example USD: 8300 means Rs 83). Not fetched automatically. */
export async function setExchangeRate(db: Db, actor: AuthUser, currency: string, paisePerUnit: number) {
  assertAuthorized(actor, "platform.admin");
  const c = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c) || c === "INR") throw new BillingError("use a 3-letter currency code other than INR");
  if (!Number.isFinite(paisePerUnit) || paisePerUnit <= 0 || paisePerUnit > 100_000_000) throw new BillingError("the rate must be above zero (paise per 1 unit)");
  await db.transaction(async (tx) => {
    await tx.execute(sql`insert into exchange_rates (currency, paise_per_unit, updated_at) values (${c}, ${paisePerUnit}, now()) on conflict (currency) do update set paise_per_unit = excluded.paise_per_unit, updated_at = now()`);
    await tx.execute(sql`select set_config('app.org_id', ${actor.orgId}, true)`);
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "billing.exchange_rate", entity: "exchange_rates", after: { currency: c, paisePerUnit } });
  });
  return { currency: c, paisePerUnit };
}

/** The signed-in person's e-mail, for gateways that need one to start a payment. */
export async function userEmail(db: Db, actor: AuthUser): Promise<string | null> {
  return withOrg(db, actor.orgId, async (tx) => (await tx.select({ e: users.email }).from(users).where(eq(users.id, actor.id)))[0]?.e ?? null);
}

// ------------------------------------------------------------------------------------------ history, usage, receipts

export interface LedgerFilter { reason?: string; from?: Date; to?: Date; limit?: number; offset?: number }

/** The credit history, newest first, with an optional kind and date range. `total` is the number of matching rows. */
export async function listLedger(db: Db, actor: AuthUser, f: LedgerFilter = {}) {
  assertAuthorized(actor, "org_settings.read");
  const limit = Math.max(1, Math.min(20_000, Math.round(f.limit ?? 50))), offset = Math.max(0, Math.round(f.offset ?? 0));
  const where: SQL[] = [];
  if (f.reason) { if (!(LEDGER_REASON_LIST as readonly string[]).includes(f.reason)) throw new BillingError("unknown kind"); where.push(eq(creditLedger.reason, f.reason as (typeof LEDGER_REASON_LIST)[number])); }
  if (f.from) where.push(gte(creditLedger.createdAt, f.from));
  if (f.to) where.push(lt(creditLedger.createdAt, f.to));
  const cond = where.length ? and(...where) : undefined;
  return withOrg(db, actor.orgId, async (tx) => ({
    total: Number((await tx.select({ n: sql<string>`count(*)` }).from(creditLedger).where(cond))[0]!.n),
    rows: await tx.select({ id: creditLedger.id, deltaPaise: creditLedger.deltaPaise, reason: creditLedger.reason, note: creditLedger.note, country: creditLedger.country, ref: creditLedger.ref, createdAt: creditLedger.createdAt })
      .from(creditLedger).where(cond).orderBy(desc(creditLedger.createdAt)).limit(limit).offset(offset),
  }));
}

export async function listPayments(db: Db, actor: AuthUser, limit = 500) {
  assertAuthorized(actor, "org_settings.read");
  return withOrg(db, actor.orgId, (tx) => tx.select({ id: payments.id, gateway: payments.gateway, gatewayPaymentId: payments.gatewayPaymentId, amountPaise: payments.amountPaise, currency: payments.currency, amountMinor: payments.amountMinor, status: payments.status, createdAt: payments.createdAt, paidAt: payments.paidAt })
    .from(payments).orderBy(desc(payments.createdAt)).limit(Math.max(1, Math.min(20_000, limit))));
}

/** What was spent in the last `days` days: by service (calls, texts) and by country, from the credit history. */
export async function usageSummary(db: Db, actor: AuthUser, days = 30) {
  assertAuthorized(actor, "org_settings.read");
  const d = Math.max(1, Math.min(366, Math.round(days)));
  return withOrg(db, actor.orgId, async (tx) => {
    const rows = await tx.select({ reason: creditLedger.reason, country: creditLedger.country, spent: sql<string>`sum(-${creditLedger.deltaPaise})`, n: sql<string>`count(*)` }).from(creditLedger)
      .where(and(sql`${creditLedger.reason} in ('usage_call','usage_sms')`, sql`${creditLedger.createdAt} >= now() - make_interval(days => ${d})`)).groupBy(creditLedger.reason, creditLedger.country);
    const by = { call: { paise: 0, count: 0 }, sms: { paise: 0, count: 0 } }, country = new Map<string, number>();
    for (const r of rows) { const k = r.reason === "usage_call" ? "call" : "sms"; by[k].paise += Number(r.spent); by[k].count += Number(r.n); const c = r.country ?? "other"; country.set(c, (country.get(c) ?? 0) + Number(r.spent)); }
    return { days: d, totalPaise: by.call.paise + by.sms.paise, calls: by.call, texts: by.sms, byCountry: [...country.entries()].map(([c, paise]) => ({ country: c, paise })).sort((a, b) => b.paise - a.paise) };
  });
}

/** One payment as a receipt: who paid, how, how much, what was credited. Receipts exist only for payments that went through. */
export async function getReceipt(db: Db, actor: AuthUser, paymentId: string) {
  assertAuthorized(actor, "org_settings.read");
  return withOrg(db, actor.orgId, async (tx) => {
    const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!p || p.status !== "paid") return null;
    const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, actor.orgId));
    const [payer] = p.createdBy ? await tx.select({ email: users.email }).from(users).where(eq(users.id, p.createdBy)) : [];
    const day = (p.paidAt ?? p.createdAt).toISOString().slice(0, 10).replace(/-/g, "");
    return { number: `R-${day}-${p.id.slice(0, 8).toUpperCase()}`, orgName: org?.name ?? "", payerEmail: payer?.email ?? null, gateway: p.gateway, gatewayPaymentId: p.gatewayPaymentId, currency: p.currency, amountMinor: p.amountMinor, creditedPaise: p.amountPaise, paidAt: p.paidAt ?? p.createdAt };
  });
}

// ------------------------------------------------------------------------------------------ staff: balances, live exchange rates

/** Platform staff: every organisation's balance and what it topped up in the last `days` days. */
export async function platformBalances(db: Db, actor: AuthUser, days = 30) {
  assertAuthorized(actor, "platform.admin");
  const r = await db.execute<{ org_id: string; org_name: string; topups_paise: string; balance_paise: string }>(sql`select * from platform_money(${Math.max(1, Math.min(366, Math.round(days)))})`);
  return r.rows.map((x) => ({ orgId: x.org_id, orgName: x.org_name, topupsPaise: Number(x.topups_paise), balancePaise: Number(x.balance_paise) }));
}

const AUTO_CURRENCIES = ["USD", "EUR", "GBP", "NGN", "GHS", "ZAR", "KES"];

/**
 * Sets every rate (for the currencies already listed, plus the ones the gateways take) from the market rate of the day
 * (open.er-api.com, free, no key). Rates are paise per one unit. A rate that comes back strange (zero, or moving more than 25 percent at once) is skipped and listed.
 * `audit` runs inside the transaction (staff refreshes are audited; the scheduled refresh has no person to attribute it to).
 */
async function applyMarketRates(db: Db, fetcher: typeof fetch, audit?: (tx: DbTx, summary: { updated: number; skipped: number }) => Promise<void>) {
  const res = await fetcher("https://open.er-api.com/v6/latest/INR", { signal: AbortSignal.timeout(10_000) }).catch(() => null);
  const body = res?.ok ? ((await res.json().catch(() => null)) as { result?: string; rates?: Record<string, number> } | null) : null;
  if (!body || body.result !== "success" || !body.rates) throw new BillingError("The market rate service did not answer. Try again in a minute, or set the rates by hand.");
  const existing = new Map((await db.select().from(exchangeRates)).map((r) => [r.currency, Number(r.paisePerUnit)]));
  const wanted = [...new Set([...existing.keys(), ...AUTO_CURRENCIES])];
  const updated: { currency: string; paisePerUnit: number }[] = [], skipped: { currency: string; why: string }[] = [];
  await db.transaction(async (tx) => {
    for (const c of wanted) {
      const perInr = body.rates![c];
      if (!perInr || !Number.isFinite(perInr) || perInr <= 0) { skipped.push({ currency: c, why: "no market rate" }); continue; }
      const paise = Math.round((100 / perInr) * 1e6) / 1e6, before = existing.get(c);
      if (before && Math.abs(paise - before) / before > 0.25) { skipped.push({ currency: c, why: `moved ${Math.round((100 * Math.abs(paise - before)) / before)} percent: check it and set it by hand` }); continue; }
      await tx.execute(sql`insert into exchange_rates (currency, paise_per_unit, updated_at) values (${c}, ${paise}, now()) on conflict (currency) do update set paise_per_unit = excluded.paise_per_unit, updated_at = now()`);
      updated.push({ currency: c, paisePerUnit: paise });
    }
    await audit?.(tx, { updated: updated.length, skipped: skipped.length });
  });
  return { updated, skipped };
}

/** Platform staff: refresh all exchange rates from the market now. */
export async function refreshExchangeRates(db: Db, actor: AuthUser, fetcher: typeof fetch = fetch) {
  assertAuthorized(actor, "platform.admin");
  return applyMarketRates(db, fetcher, async (tx, after) => {
    await tx.execute(sql`select set_config('app.org_id', ${actor.orgId}, true)`);
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "billing.exchange_rate_refresh", entity: "exchange_rates", after });
  });
}

/** For the background worker: refresh the rates if they are older than `maxAgeHours` (or there are none). Returns null when they were fresh enough. */
export async function refreshExchangeRatesIfStale(db: Db, maxAgeHours = 6, fetcher: typeof fetch = fetch) {
  const r = await db.execute<{ stale: boolean }>(sql`select coalesce(max(updated_at) < now() - make_interval(hours => ${maxAgeHours}), true) as stale from exchange_rates`);
  if (!r.rows[0]?.stale) return null;
  return applyMarketRates(db, fetcher);
}

export async function deleteExchangeRate(db: Db, actor: AuthUser, currency: string) {
  assertAuthorized(actor, "platform.admin");
  const c = currency.trim().toUpperCase();
  await db.transaction(async (tx) => {
    const gone = await tx.delete(exchangeRates).where(eq(exchangeRates.currency, c)).returning({ c: exchangeRates.currency });
    if (!gone.length) throw new BillingError("there is no rate for that currency");
    await tx.execute(sql`select set_config('app.org_id', ${actor.orgId}, true)`);
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "billing.exchange_rate_delete", entity: "exchange_rates", after: { currency: c } });
  });
  return { currency: c };
}

// ------------------------------------------------------------------------------------------ low-balance alerts (worker)

export interface LowBalanceJob { orgId: string; orgName: string; balancePaise: number; thresholdPaise: number; emails: string[] }
export async function lowBalanceDue(db: Db, limit = 20): Promise<LowBalanceJob[]> {
  const r = await db.execute<{ org_id: string; org_name: string; balance_paise: string; threshold_paise: string; emails: string[] }>(sql`select * from worker_low_balance_due(${limit})`);
  return r.rows.map((x) => ({ orgId: x.org_id, orgName: x.org_name, balancePaise: Number(x.balance_paise), thresholdPaise: Number(x.threshold_paise), emails: x.emails }));
}
export async function lowBalanceSent(db: Db, orgId: string) { await db.execute(sql`select worker_low_balance_sent(${orgId}::uuid)`); }
