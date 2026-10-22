import { index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { consentSubjectType, createdAt, id, orgIsolationPolicy, tstz, voiceGender, voiceProfileStatus } from "./_common";
import { organizations, teams, users } from "./org";

/** Voice-clone and recording consent (SOP: Voice-clone consent lifecycle). */
export const consentRecords = pgTable(
  "consent_records",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references(() => teams.id),
    subjectType: consentSubjectType("subject_type").notNull(),
    /** users.id for staff, leads.id for callers; polymorphic, so no FK. */
    subjectId: uuid("subject_id").notNull(),
    purpose: text("purpose").notNull(),
    method: text("method").notNull(),
    documentUrl: text("document_url").notNull(),
    grantedAt: tstz("granted_at").notNull(),
    revokedAt: tstz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [index("consent_records_subject_idx").on(t.subjectType, t.subjectId), orgIsolationPolicy()],
).enableRLS();

export const voiceProfiles = pgTable(
  "voice_profiles",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    teamId: uuid("team_id").references(() => teams.id),
    label: text("label").notNull(),
    gender: voiceGender("gender").notNull(),
    provider: text("provider").notNull().default("elevenlabs"),
    providerVoiceId: text("provider_voice_id").notNull(),
    donorUserId: uuid("donor_user_id").notNull().references(() => users.id),
    /** Every voice must be backed by a consent record (Phase 1 done-when). */
    consentRecordId: uuid("consent_record_id").notNull().references(() => consentRecords.id),
    status: voiceProfileStatus("status").notNull().default("active"),
    /** Set on revocation; SOP requires revoked within 24 h of withdrawal/exit. */
    revokedAt: tstz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("voice_profiles_provider_voice_uq").on(t.provider, t.providerVoiceId),
    index("voice_profiles_org_status_idx").on(t.orgId, t.status),
    orgIsolationPolicy(),
  ],
).enableRLS();
