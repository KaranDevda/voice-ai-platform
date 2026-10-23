import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, real, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { TranscriptSegment } from "@voiceai/shared";
import {
  callDirection,
  callSource,
  callStatus,
  createdAt,
  id,
  leadStatus,
  orgIsolationPolicy,
  sentimentLabel,
  tstz,
} from "./_common";
import { devices, organizations, teams, users } from "./org";
import { leads } from "./crm";
import { voiceProfiles } from "./voice";

/**
 * One row per call from any source (AI, web dialer, mobile SIM).
 * team_id rule: a call made by an agent belongs to the AGENT's team; an AI call takes the lead's team.
 * Team-scoped reports and reads depend on this, so ingest code must set it that way.
 */
export const callLogs = pgTable(
  "call_logs",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references(() => teams.id),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    /** Null for pure-AI calls. */
    agentUserId: uuid("agent_user_id").references(() => users.id, { onDelete: "set null" }),
    voiceProfileId: uuid("voice_profile_id").references(() => voiceProfiles.id),
    direction: callDirection("direction").notNull(),
    source: callSource("source").notNull(),
    status: callStatus("status").notNull(),
    startedAt: tstz("started_at").notNull(),
    durationS: integer("duration_s").notNull().default(0),
    providerCallUuid: text("provider_call_uuid"),
    deviceId: uuid("device_id").references(() => devices.id, { onDelete: "set null" }),
    /** S3 object key; served via 5-minute signed URLs only. */
    recordingKey: text("recording_key"),
    handoffToUserId: uuid("handoff_to_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Mobile: device_id + call_log_id (SOP: offline queue). */
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (t) => [
    index("call_logs_lead_started_idx").on(t.leadId, t.startedAt.desc()),
    index("call_logs_agent_started_idx").on(t.agentUserId, t.startedAt),
    uniqueIndex("call_logs_idempotency_uq").on(t.idempotencyKey),
    uniqueIndex("call_logs_provider_call_uq").on(t.providerCallUuid),
    orgIsolationPolicy(),
  ],
).enableRLS();

export const callTranscripts = pgTable(
  "call_transcripts",
  {
    callLogId: uuid("call_log_id").primaryKey().references(() => callLogs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references(() => teams.id),
    segments: jsonb("segments").$type<TranscriptSegment[]>().notNull(),
    language: text("language").notNull().default("en"),
    createdAt: createdAt(),
  },
  () => [orgIsolationPolicy()],
).enableRLS();

export const callInsights = pgTable(
  "call_insights",
  {
    callLogId: uuid("call_log_id").primaryKey().references(() => callLogs.id, { onDelete: "cascade" }),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references(() => teams.id),
    summary: text("summary").notNull(),
    sentimentScore: real("sentiment_score").notNull(),
    sentimentLabel: sentimentLabel("sentiment_label").notNull(),
    intent: text("intent"),
    nextAction: text("next_action"),
    suggestedStatus: leadStatus("suggested_status"),
    /** Auto-applied only when >= 0.8, else queued for the owner (SOP: auto status rules). */
    suggestedStatusConfidence: real("suggested_status_confidence"),
    modelVersion: text("model_version").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("call_insights_sentiment_range", sql`${t.sentimentScore} between -1 and 1`),
    check(
      "call_insights_confidence_range",
      sql`${t.suggestedStatusConfidence} is null or ${t.suggestedStatusConfidence} between 0 and 1`,
    ),
    orgIsolationPolicy(),
  ],
).enableRLS();
