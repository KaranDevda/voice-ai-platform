import { sql } from "drizzle-orm";
import { boolean, customType, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgIsolationPolicy, tstz } from "./_common";
import { leads } from "./crm";
import { organizations, users } from "./org";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "running", "paused", "completed", "cancelled"] as const;
export const TARGET_STATUSES = ["pending", "calling", "done", "failed", "skipped"] as const;

/** Reusable instructions and a private knowledge text for campaign agents. */
export const agentProfiles = pgTable(
  "agent_profiles",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    instructions: text("instructions").notNull(),
    knowledgeText: text("knowledge_text").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("agent_profiles_org_name_uq").on(t.orgId, t.name), orgIsolationPolicy()],
).enableRLS();

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
    /** Optional campaign model override; null inherits the organisation's AI setting. */
    aiModel: text("ai_model", { enum: ["default", "openrouter"] }),
    openrouterModel: text("openrouter_model"),
    agentProfileId: uuid("agent_profile_id").references(() => agentProfiles.id, { onDelete: "set null" }),
    /** An organisation-owned Plivo voice number; null uses the deployment default. */
    callerId: text("caller_id"),
    startAt: tstz("start_at"),
    maxConcurrent: integer("max_concurrent").notNull().default(2),
    maxAttempts: integer("max_attempts").notNull().default(2),
    retryDelayMin: integer("retry_delay_min").notNull().default(60),
    /** Hang up when the phone line hears an answering machine, and try the person again later. */
    detectMachines: boolean("detect_machines").notNull().default(true),
    /** "ai": an AI conversation (the default). "audio": a pre-recorded message is played when the person answers. */
    mode: text("mode", { enum: ["ai", "audio"] }).notNull().default("ai"),
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

/** Reusable campaign settings. A template stores audience tags and call settings, never a copied lead list or schedule. */
export const campaignTemplates = pgTable(
  "campaign_templates",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    language: text("language").notNull().default("en-hi"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    callerId: text("caller_id"),
    aiModel: text("ai_model", { enum: ["default", "openrouter"] }),
    openrouterModel: text("openrouter_model"),
    agentProfileId: uuid("agent_profile_id").references(() => agentProfiles.id, { onDelete: "set null" }),
    autoSchedule: boolean("auto_schedule").notNull().default(false),
    maxConcurrent: integer("max_concurrent").notNull().default(2),
    maxAttempts: integer("max_attempts").notNull().default(2),
    retryDelayMin: integer("retry_delay_min").notNull().default(60),
    detectMachines: boolean("detect_machines").notNull().default(true),
    mode: text("mode", { enum: ["ai", "audio"] }).notNull().default("ai"),
    openingVariants: text("opening_variants").array().notNull().default(sql`'{}'::text[]`),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("campaign_templates_org_name_uq").on(t.orgId, t.name), index("campaign_templates_org_created_idx").on(t.orgId, t.createdAt), orgIsolationPolicy()],
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

/** The recording an audio campaign plays (MP3 or WAV, at most 5 MB). */
export const campaignAudio = pgTable(
  "campaign_audio",
  {
    campaignId: uuid("campaign_id").primaryKey().references(() => campaigns.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    mime: text("mime", { enum: ["audio/mpeg", "audio/wav"] }).notNull(),
    data: bytea("data").notNull(),
    createdAt: createdAt(),
  },
  () => [orgIsolationPolicy()],
).enableRLS();
