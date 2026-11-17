import { sql } from "drizzle-orm";
import { boolean, customType, index, integer, pgTable, real, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
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
    /** Optional stable identifier for resolution (e.g. name/slug); never a provider placeholder. */
    slug: text("slug"),
    gender: voiceGender("gender").notNull(),
    provider: text("provider").notNull().default("elevenlabs"),
    providerVoiceId: text("provider_voice_id").notNull(),
    /** How fast this voice speaks (1 = as recorded) and its pitch shift in semitones (0 = as recorded). Applied to cloned-voice speech. */
    speed: real("speed").notNull().default(1),
    pitch: real("pitch").notNull().default(0),
    donorUserId: uuid("donor_user_id").notNull().references(() => users.id),
    /** Every voice must be backed by a consent record (Phase 1 done-when). */
    consentRecordId: uuid("consent_record_id").notNull().references(() => consentRecords.id),
    status: voiceProfileStatus("status").notNull().default("active"),
    /** True for staff/custom cloned voices that must be preserved across syncs and reseeds. */
    isCloned: boolean("is_cloned").notNull().default(false),
    /** Set on revocation; SOP requires revoked within 24 h of withdrawal/exit. */
    revokedAt: tstz("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("voice_profiles_provider_voice_uq").on(t.provider, t.providerVoiceId),
    uniqueIndex("voice_profiles_org_slug_uq").on(t.orgId, t.slug).where(sql`"slug" is not null`),
    index("voice_profiles_org_status_idx").on(t.orgId, t.status),
    orgIsolationPolicy(),
  ],
).enableRLS();

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

/**
 * The recording a voice was cloned from, kept so the voice can be re-made, heard on the website, and sent to the open-source engine
 * (Chatterbox) that clones from a recording. It is biometric data: only people who may manage voices can read it, it is isolated per
 * organisation, and it is deleted with the voice. The consent record must cover keeping it.
 */
export const voiceSamples = pgTable(
  "voice_samples",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    voiceProfileId: uuid("voice_profile_id").notNull().references(() => voiceProfiles.id, { onDelete: "cascade" }),
    mime: text("mime").notNull().default("audio/wav"),
    bytes: integer("bytes").notNull(),
    audio: bytea("audio").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("voice_samples_profile_uq").on(t.voiceProfileId), orgIsolationPolicy()],
).enableRLS();
