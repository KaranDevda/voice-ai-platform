import { index, integer, jsonb, pgTable, text, unique, uuid, vector } from "drizzle-orm/pg-core";
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
