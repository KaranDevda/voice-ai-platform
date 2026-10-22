import { sql } from "drizzle-orm";
import { pgEnum, pgPolicy, timestamp, uuid } from "drizzle-orm/pg-core";
import {
  CALL_DIRECTIONS,
  CALL_SOURCES,
  CALL_STATUSES,
  CONSENT_SUBJECT_TYPES,
  DEVICE_PLATFORMS,
  LEAD_CONSENT_STATUSES,
  LEAD_STATUSES,
  SENTIMENT_LABELS,
  STATUS_CHANGERS,
  USER_STATUSES,
  VOICE_GENDERS,
  VOICE_PROFILE_STATUSES,
} from "@voiceai/shared";

export const userStatus = pgEnum("user_status", USER_STATUSES);
export const devicePlatform = pgEnum("device_platform", DEVICE_PLATFORMS);
export const leadStatus = pgEnum("lead_status", LEAD_STATUSES);
export const leadConsentStatus = pgEnum("lead_consent_status", LEAD_CONSENT_STATUSES);
export const statusChanger = pgEnum("status_changer", STATUS_CHANGERS);
export const voiceGender = pgEnum("voice_gender", VOICE_GENDERS);
export const voiceProfileStatus = pgEnum("voice_profile_status", VOICE_PROFILE_STATUSES);
export const consentSubjectType = pgEnum("consent_subject_type", CONSENT_SUBJECT_TYPES);
export const callDirection = pgEnum("call_direction", CALL_DIRECTIONS);
export const callSource = pgEnum("call_source", CALL_SOURCES);
export const callStatus = pgEnum("call_status", CALL_STATUSES);
export const sentimentLabel = pgEnum("sentiment_label", SENTIMENT_LABELS);

export const id = () => uuid("id").primaryKey().defaultRandom();
export const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const tstz = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Postgres RLS second wall (SOP: RBAC implementation). The app sets `app.org_id` per
 * transaction (SET LOCAL); rows from other orgs become invisible even if a query forgets
 * the org_id filter. The app's DB role must not own the tables (owners bypass RLS).
 */
export const orgIsolationPolicy = () =>
  pgPolicy("org_isolation", {
    as: "permissive",
    for: "all",
    using: sql`org_id = nullif(current_setting('app.org_id', true), '')::uuid`,
    withCheck: sql`org_id = nullif(current_setting('app.org_id', true), '')::uuid`,
  });
