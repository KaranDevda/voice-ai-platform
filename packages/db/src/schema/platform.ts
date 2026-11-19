import { boolean, index, integer, jsonb, pgTable, text, unique, uuid, vector } from "drizzle-orm/pg-core";
import { createdAt, id, orgIsolationPolicy, tstz } from "./_common";
import { organizations, teams, users } from "./org";

/** Must match the configured embedding model's output size. */
export const EMBEDDING_DIMENSIONS = 1536;

export const kbDocuments = pgTable(
  "kb_documents",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references(() => teams.id),
    title: text("title").notNull(),
    sourceUrl: text("source_url"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  () => [orgIsolationPolicy()],
).enableRLS();

export const kbChunks = pgTable(
  "kb_chunks",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references(() => teams.id),
    documentId: uuid("document_id").notNull().references(() => kbDocuments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    /** Null until the embedding service is connected; retrieval falls back to keyword search meanwhile. */
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("kb_chunks_doc_idx_uq").on(t.documentId, t.chunkIndex),
    index("kb_chunks_embedding_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
    orgIsolationPolicy(),
  ],
).enableRLS();

/** Append-only; a trigger in migration 0001 rejects UPDATE and DELETE. */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references(() => teams.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    before: jsonb("before"),
    after: jsonb("after"),
    at: tstz("at").notNull().defaultNow(),
  },
  (t) => [index("audit_logs_org_at_idx").on(t.orgId, t.at), index("audit_logs_entity_idx").on(t.entity, t.entityId), orgIsolationPolicy()],
).enableRLS();

/** Provider-level (pre-tenant) so no org_id/RLS; dedupes webhook deliveries. */
export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: tstz("received_at").notNull().defaultNow(),
    processedAt: tstz("processed_at"),
  },
  (t) => [unique("webhook_events_provider_event_uq").on(t.provider, t.eventId)],
);

/** Scheduled export jobs (org-scoped, RLS-enabled). */
export const cronJobs = pgTable(
  "cron_jobs",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references(() => teams.id),
    userId: uuid("user_id").references(() => users.id),
    name: text("name").notNull(),
    reportType: text("report_type", { enum: ["contacts", "calls", "sms"] }).notNull(),
    cron: text("cron").notNull(),
    timezone: text("timezone").notNull().default("Asia/Kolkata"),
    email: text("email"),
    active: boolean("active").notNull().default(true),
    nextRun: tstz("next_run"),
    lastRun: tstz("last_run"),
    createdAt: createdAt(),
  },
  (t) => [index("cron_jobs_org_active_idx").on(t.orgId, t.active), orgIsolationPolicy()],
).enableRLS();

/** Application error log: captures unhandled errors from API routes and client. Org-scoped via RLS. */
export const appErrors = pgTable(
  "app_errors",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references(() => teams.id),
    userId: uuid("user_id").references(() => users.id),
    route: text("route").notNull(),
    method: text("method"),
    errorMessage: text("error_message").notNull(),
    errorStack: text("error_stack"),
    requestBody: jsonb("request_body"),
    requestHeaders: jsonb("request_headers"),
    userAgent: text("user_agent"),
    ip: text("ip"),
    at: tstz("at").notNull().defaultNow(),
    resolvedAt: tstz("resolved_at"),
    resolvedBy: uuid("resolved_by").references(() => users.id),
  },
  (t) => [index("app_errors_org_at_idx").on(t.orgId, t.at), index("app_errors_route_idx").on(t.route), orgIsolationPolicy()],
).enableRLS();

/** Extra languages per org (org-scoped, RLS-enabled). */
export const extraLanguages = pgTable(
  "extra_languages",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    nativeName: text("native_name").notNull(),
    rtl: boolean("rtl").notNull().default(false),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique("extra_languages_org_code_uq").on(t.orgId, t.code), index("extra_languages_org_idx").on(t.orgId), orgIsolationPolicy()],
).enableRLS();

/** Translation overrides per org (org-scoped, RLS-enabled). */
export const translations = pgTable(
  "translations",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    lang: text("lang").notNull(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
  },
  (t) => [unique("translations_org_lang_key_uq").on(t.orgId, t.lang, t.key), index("translations_org_lang_idx").on(t.orgId, t.lang), orgIsolationPolicy()],
).enableRLS();
