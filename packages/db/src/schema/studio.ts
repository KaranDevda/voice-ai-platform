import { customType, index, integer, jsonb, numeric, pgEnum, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, orgIsolationPolicy } from "./_common";
import { organizations, teams, users } from "./org";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const studioAssetKind = pgEnum("studio_asset_kind", ["speech", "transcript"]);

/**
 * Saved studio output. Audio sits in Postgres for now (clips are small); move it behind an object-store
 * adapter (S3, SOP) before large files or production.
 */
export const studioAssets = pgTable(
  "studio_assets",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references(() => teams.id),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: studioAssetKind("kind").notNull(),
    title: text("title").notNull(),
    /** Script for speech, full transcript text for transcripts. */
    text: text("text").notNull(),
    provider: text("provider").notNull(),
    /** Voice used, e.g. "dg:aura-2-thalia-en" or "profile:<uuid>"; null for transcripts. */
    voiceRef: text("voice_ref"),
    mime: text("mime"),
    audio: bytea("audio"),
    durationMs: integer("duration_ms"),
    /** Transcript segments, language, etc. */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("studio_assets_user_created_idx").on(t.orgId, t.userId, t.createdAt), orgIsolationPolicy()],
).enableRLS();

/** One row per outbound provider call: powers the logs page and per-call cost tracking (SOP: Risks). */
export const providerUsage = pgTable(
  "provider_usage",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    operation: text("operation").notNull(),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    /** Characters for speech, seconds of audio for transcription, tokens when known. */
    units: numeric("units", { precision: 12, scale: 2, mode: "number" }).notNull().default(0),
    error: text("error"),
    createdAt: createdAt(),
  },
  (t) => [index("provider_usage_org_created_idx").on(t.orgId, t.createdAt), orgIsolationPolicy()],
).enableRLS();
