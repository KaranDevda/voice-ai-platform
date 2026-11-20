import { bigint, boolean, customType, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgIsolationPolicy, tstz } from "./_common";
import { organizations } from "./org";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

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

/** The PAN card and GST certificate sent with a request. Row-level secured like the request itself. */
export const kycDocuments = pgTable(
  "kyc_documents",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    submissionId: uuid("submission_id").notNull().references(() => kycSubmissions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["pan", "gst"] }).notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("kyc_documents_submission_idx").on(t.submissionId), orgIsolationPolicy()],
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
    /** Which carrier the number is rented from. SIP trunks (BYOC) exist for Twilio numbers only. */
    carrier: text("carrier", { enum: ["plivo", "twilio"] }).notNull().default("plivo"),
    /** The SIP trunk the number routes through (Twilio only); empty means Twilio's own webhook handling. */
    trunkId: uuid("trunk_id"),
    createdAt: createdAt(),
    assignedAt: tstz("assigned_at"),
  },
  (t) => [uniqueIndex("phone_numbers_e164_uq").on(t.e164), orgIsolationPolicy()],
).enableRLS();

/** Bring-your-own-carrier SIP trunks (Twilio Elastic SIP Trunking): the customer's own carrier or PBX sends and receives calls through Twilio. */
export const sipTrunks = pgTable(
  "sip_trunks",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    carrier: text("carrier", { enum: ["twilio"] }).notNull().default("twilio"),
    providerTrunkSid: text("provider_trunk_sid").notNull(),
    terminationDomain: text("termination_domain"),
    originationUrls: text("origination_urls").array().notNull().default([]),
    lastHealthStatus: text("last_health_status", { enum: ["ok", "degraded", "down"] }),
    lastHealthJson: jsonb("last_health_json").$type<{ checks: Array<{ name: string; status: string; detail: string }> }>(),
    lastCheckedAt: tstz("last_checked_at"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sip_trunks_provider_sid_uq").on(t.providerTrunkSid), index("sip_trunks_org_idx").on(t.orgId), orgIsolationPolicy()],
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
