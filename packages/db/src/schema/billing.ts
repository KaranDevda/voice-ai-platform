import { bigint, index, integer, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgIsolationPolicy, tstz } from "./_common";
import { organizations } from "./org";

export const LEDGER_REASONS = ["topup", "usage_call", "usage_sms", "adjustment", "refund"] as const;

/** Every change to an organisation's credit, in paise. The balance is the sum. Rows are never edited or deleted. */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    deltaPaise: bigint("delta_paise", { mode: "number" }).notNull(),
    reason: text("reason", { enum: LEDGER_REASONS }).notNull(),
    ref: text("ref"),
    /** The same event can never be recorded twice (a repeated webhook, a call saved twice). */
    idempotencyKey: text("idempotency_key"),
    note: text("note"),
    /** Usage rows: the country of the number called or texted (from its dialling code). */
    country: text("country"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("credit_ledger_org_created_idx").on(t.orgId, t.createdAt), orgIsolationPolicy()],
).enableRLS();

export const payments = pgTable(
  "payments",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    gateway: text("gateway", { enum: ["razorpay", "stripe", "paypal", "paystack", "flutterwave", "cryptomus"] }).notNull(),
    /** The gateway's id for this payment link or checkout session. */
    gatewayRef: text("gateway_ref"),
    /** What the organisation is credited, in paise, at the exchange rate fixed when the payment started. */
    amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("INR"),
    /** What the gateway charges, in its currency's smallest unit (cents); empty for rupee payments. */
    amountMinor: bigint("amount_minor", { mode: "number" }),
    status: text("status", { enum: ["created", "paid", "failed"] }).notNull().default("created"),
    gatewayPaymentId: text("gateway_payment_id"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    paidAt: tstz("paid_at"),
  },
  () => [orgIsolationPolicy()],
).enableRLS();

/** An organisation's price for one country (paise). Where there is none, the standard price in Settings applies. */
export const countryRates = pgTable(
  "country_rates",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    country: text("country").notNull(),
    callPerMinPaise: integer("call_per_min_paise").notNull(),
    smsPaise: integer("sms_paise").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("country_rates_org_country_uq").on(t.orgId, t.country), orgIsolationPolicy()],
).enableRLS();

/** How many paise one unit of a foreign currency is worth. Set by platform staff; used to credit payments made in that currency. */
export const exchangeRates = pgTable("exchange_rates", {
  currency: text("currency").primaryKey(),
  paisePerUnit: numeric("paise_per_unit", { precision: 18, scale: 6 }).notNull(),
  updatedAt: tstz("updated_at").notNull().defaultNow(),
});
