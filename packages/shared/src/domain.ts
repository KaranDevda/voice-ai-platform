import { z } from "zod";

/** Single source of truth for enum values; the Drizzle schema and zod validators both read these. */
export const LEAD_STATUSES = [
  "new",
  "contacted",
  "interested",
  "callback_requested",
  "not_interested",
  "won",
  "lost",
] as const;
export const LEAD_CONSENT_STATUSES = ["unknown", "granted", "denied", "withdrawn"] as const;
export const CALL_DIRECTIONS = ["inbound", "outbound"] as const;
export const CALL_SOURCES = ["ai_inbound", "ai_outbound", "web_dialer", "mobile_sim"] as const;
export const CALL_STATUSES = ["connected", "missed", "rejected", "failed"] as const;
export const VOICE_PROFILE_STATUSES = ["active", "revoked"] as const;
export const VOICE_GENDERS = ["male", "female"] as const;
export const CONSENT_SUBJECT_TYPES = ["staff", "caller"] as const;
export const USER_STATUSES = ["active", "suspended", "disabled"] as const;
export const SENTIMENT_LABELS = ["positive", "neutral", "negative"] as const;
export const STATUS_CHANGERS = ["user", "ai"] as const;
export const DEVICE_PLATFORMS = ["android"] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];
export type CallSource = (typeof CALL_SOURCES)[number];
export type VoiceGender = (typeof VOICE_GENDERS)[number];

export const transcriptSegmentSchema = z.object({
  speaker: z.enum(["ai", "caller", "agent"]),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  /** True when the caller barged in and this AI reply was cut off (SOP: interrupted replies are marked). */
  interrupted: z.boolean().optional(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const consentRecordInputSchema = z.object({
  subjectType: z.enum(CONSENT_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  purpose: z.string().min(1),
  /** e.g. "written_signed", "verbal_recorded" */
  method: z.string().min(1),
  documentUrl: z.string().min(1),
  grantedAt: z.coerce.date(),
});

export const voiceProfileInputSchema = z.object({
  label: z.string().min(1),
  gender: z.enum(VOICE_GENDERS),
  provider: z.string().default("elevenlabs"),
  providerVoiceId: z.string().min(1),
  donorUserId: z.string().uuid(),
  consentRecordId: z.string().uuid(),
});
