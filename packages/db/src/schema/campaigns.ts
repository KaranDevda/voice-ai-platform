import { sql } from "drizzle-orm";
import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgIsolationPolicy, tstz } from "./_common";
import { leads } from "./crm";
import { organizations, users } from "./org";

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "running", "paused", "completed", "cancelled"] as const;
export const TARGET_STATUSES = ["pending", "calling", "done", "failed", "skipped"] as const;

/** An outbound AI calling campaign: who to call (targets), when, how many at once, and how often to try again. */
export const campaigns = pgTable(
  "campaigns",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    status: text("status", { enum: CAMPAIGN_STATUSES }).notNull().default("draft"),
    language: text("language").notNull().default("en-hi"),
    /** Voice reference the calls use (e.g. "profile:<id>"); empty = the service default. */
    voice: text("voice"),
    startAt: tstz("start_at"),
    maxConcurrent: integer("max_concurrent").notNull().default(2),
    maxAttempts: integer("max_attempts").notNull().default(2),
    retryDelayMin: integer("retry_delay_min").notNull().default(60),
    /** Hang up when the phone line hears an answering machine, and try the person again later. */
    detectMachines: boolean("detect_machines").notNull().default(true),
    /** A/B test: up to 3 opening lines; each person gets one (kept for retries). Empty = the agent's normal greeting. */
    openingVariants: text("opening_variants").array().notNull().default(sql`'{}'::text[]`),
    /** The calls run with this person's permissions. */
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    startedAt: tstz("started_at"),
    finishedAt: tstz("finished_at"),
  },
  (t) => [index("campaigns_org_created_idx").on(t.orgId, t.createdAt), orgIsolationPolicy()],
).enableRLS();

export const campaignTargets = pgTable(
  "campaign_targets",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    status: text("status", { enum: TARGET_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    /** Which opening line (1 to 3) this person got, when the campaign is an A/B test. */
    variant: integer("variant"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    calledAt: tstz("called_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("campaign_targets_campaign_lead_uq").on(t.campaignId, t.leadId),
    index("campaign_targets_due_idx").on(t.campaignId, t.status, t.nextAttemptAt),
    orgIsolationPolicy(),
  ],
).enableRLS();
