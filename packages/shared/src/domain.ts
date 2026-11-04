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
export const DEVICE_PLATFORMS = ["android", "ios"] as const;

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

export const DEFAULT_DISCLOSURE =
  "Hello, you are speaking with an AI assistant. This call is recorded for quality and service purposes.";

/** Stored in organizations.settings_json. Every field has a default so older rows still parse. */
export const orgSettingsSchema = z.object({
  ai: z
    .object({
      greeting: z.string().max(500).default("Thanks for calling. How can I help you today?"),
      disclosure: z.string().min(1).max(500).default(DEFAULT_DISCLOSURE),
      systemPrompt: z.string().max(8000).default("You are a helpful, concise phone assistant. Answer only from the knowledge base."),
      handoffMessage: z.string().max(300).default("Let me connect you with a colleague."),
      handoffOnComplaint: z.boolean().default(true),
      handoffOnPayment: z.boolean().default(true),
      handoffAfterLowConfidence: z.number().int().min(1).max(5).default(2),
      handoffTimeoutSeconds: z.number().int().min(10).max(120).default(30),
      /** Which AI answers calls. "default" is AskG1; "openrouter" uses the model named below through OpenRouter (needs an OpenRouter key on the server). */
      model: z.enum(["default", "openrouter"]).default("default"),
      /** OpenRouter model id, like "openai/gpt-4o-mini". */
      openrouterModel: z.string().regex(/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i, "use the OpenRouter model id, like openai/gpt-4o-mini").max(100).default("openai/gpt-4o-mini"),
    })
    .prefault({}),
  calling: z
    .object({
      windowStart: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
      windowEnd: z.string().regex(/^\d{2}:\d{2}$/).default("21:00"),
    })
    .prefault({}),
  /** Prepaid credit. Off by default: nothing is charged and nothing is blocked until an admin turns it on. Prices are in paise (100 paise = Rs 1). */
  billing: z
    .object({
      enabled: z.boolean().default(false),
      /** Charged per started minute of an AI call. */
      callPerMinPaise: z.number().int().min(0).max(100_000).default(0),
      smsPaise: z.number().int().min(0).max(100_000).default(0),
      /** With this on, calls and texts are refused when the balance is zero or less. */
      enforce: z.boolean().default(false),
    })
    .prefault({}),
  /** Texts. With auto-reply on, an incoming text is answered by the AI (from the knowledge base) as a queued text. Needs numbers that can receive SMS (not Indian numbers on Plivo). */
  sms: z.object({ autoReply: z.boolean().default(false) }).prefault({}),
  /** With this on, campaigns, texts and follow-up sequences need the organisation to have passed KYC (basic or business). Off by default. */
  compliance: z.object({ requireKyc: z.boolean().default(false) }).prefault({}),
  /** The phone line: who a call is handed to, and the optional touch-tone menu callers hear first (press 1 for ..., press 2 for ...). */
  phone: z
    .object({
      /** E.164, for example +919876543210. Empty = the PLIVO_HANDOFF_NUMBER set on the server. */
      handoffNumber: z.string().regex(/^(\+\d{8,15})?$/).default(""),
      menu: z
        .object({
          enabled: z.boolean().default(false),
          prompt: z.string().max(300).default("Press 1 to talk to our assistant, or press 2 to speak to a person."),
          promptHi: z.string().max(300).default("हमारे असिस्टेंट से बात करने के लिए एक दबाइए, या किसी व्यक्ति से बात करने के लिए दो दबाइए।"),
          /** Key (0-9, *, #) to what it does. */
          options: z.record(z.string().regex(/^[0-9*#]$/), z.enum(["ai", "person", "hangup"])).default({ "1": "ai", "2": "person" }),
        })
        .prefault({}),
    })
    .prefault({}),
});
export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export const orgSettingsUpdateSchema = z.object({
  settings: orgSettingsSchema,
  dataRetentionDays: z.number().int().min(30).max(3650),
  recordingRetentionDays: z.number().int().min(7).max(3650),
});

/** Allowed speed (1 = as recorded) and pitch shift (semitones) for a cloned voice. Wider settings make words hard to understand. */
export const SPEED_RANGE = { min: 0.8, max: 1.25 } as const;
export const PITCH_RANGE = { min: -3, max: 3 } as const;
