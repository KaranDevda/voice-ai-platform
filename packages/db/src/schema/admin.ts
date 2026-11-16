import { bigint, boolean, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgIsolationPolicy, tstz } from "./_common";
import { organizations } from "./org";

export const KYC_TIERS = ["unverified", "basic", "business"] as const;

/** An organisation's request to be verified. A person at the platform reviews it; approval raises organizations.kyc_tier. */
export const kycSubmissions = pgTable(
  "kyc_submissions",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    tier: text("tier", { enum: ["basic", "business"] }).notNull(),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    legalName: text("legal_name").notNull(),
    pan: text("pan").notNull(),
    gstin: text("gstin"),
    contactName: text("contact_name").notNull(),
    contactPhone: text("contact_phone").notNull(),
    address: text("address").notNull(),
    submittedBy: uuid("submitted_by"),
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: tstz("reviewed_at"),
    createdAt: createdAt(),
  },
  (t) => [index("kyc_submissions_org_idx").on(t.orgId, t.createdAt), orgIsolationPolicy()],
).enableRLS();

/** The platform's phone numbers: unassigned (org_id empty) or given to one organisation. */
export const phoneNumbers = pgTable(
  "phone_numbers",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id),
    e164: text("e164").notNull(),
    label: text("label"),
    capabilities: text("capabilities").array().notNull().default(["voice", "sms"]),
    status: text("status", { enum: ["available", "pending", "assigned", "released"] }).notNull().default("available"),
    createdAt: createdAt(),
    assignedAt: tstz("assigned_at"),
  },
  (t) => [uniqueIndex("phone_numbers_e164_uq").on(t.e164), orgIsolationPolicy()],
).enableRLS();

export const numberRequests = pgTable(
  "number_requests",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    kind: text("kind", { enum: ["local", "tollfree"] }).notNull(),
    country: text("country").notNull().default("IN"),
    purpose: text("purpose"),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    numberId: uuid("number_id"),
    reviewNote: text("review_note"),
    reviewedBy: uuid("reviewed_by"),
    reviewedAt: tstz("reviewed_at"),
    requestedBy: uuid("requested_by"),
    createdAt: createdAt(),
  },
  (t) => [index("number_requests_status_idx").on(t.status, t.createdAt), orgIsolationPolicy()],
).enableRLS();

export const jobHeartbeats = pgTable("job_heartbeats", {
  name: text("name").primaryKey(),
  lastRunAt: tstz("last_run_at").notNull().defaultNow(),
  lastOk: boolean("last_ok").notNull().default(true),
  lastError: text("last_error"),
  runs: bigint("runs", { mode: "number" }).notNull().default(0),
});
