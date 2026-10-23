/**
 * Permissions are strings. Record-level ones are `<resource>.<action>.<scope>`
 * (e.g. leads.read.team); the rest are plain flags (e.g. calls.place).
 */
export type Scope = "all" | "team" | "own" | "aggregate";

/** Widest first; resolveScope picks the first one a user holds. */
export const SCOPE_ORDER: readonly Scope[] = ["all", "team", "own", "aggregate"];

export const SCOPED_PERMISSIONS = {
  "leads.read": ["all", "team", "own"],
  "leads.write": ["all", "team", "own"],
  "leads.assign": ["all", "team"],
  "leads.export": ["all", "team"],
  "leads.status_override": ["all", "team", "own"],
  "calls.read": ["all", "team", "own", "aggregate"],
  "recordings.play": ["all", "team", "own"],
  "recordings.download": ["all"],
  "transcripts.read": ["all", "team", "own"],
  "users.read": ["all", "team"],
  "devices.revoke": ["all", "team"],
  "reports.read": ["all", "team", "own", "aggregate"],
  /** Studio projects: saved generated speech and transcripts. */
  "projects.read": ["all", "own"],
  "projects.delete": ["all", "own"],
} as const satisfies Record<string, readonly Scope[]>;

export const FLAG_PERMISSIONS = [
  "leads.pii.read",
  "calls.place",
  "voice_profiles.manage",
  "kb.read",
  "kb.write",
  "ai_prompts.read",
  "ai_prompts.write",
  "users.write",
  "audit.read",
  "org_settings.read",
  "org_settings.write",
  /** Voice studio: text-to-speech, transcription, voice cloning wizard, agent console. */
  "studio.use",
  /** Provider usage and error log. */
  "logs.read",
  /** Platform (Super Admin) staff: may act across orgs. */
  "platform.admin",
] as const;

export type ScopedBase = keyof typeof SCOPED_PERMISSIONS;
export type ScopedPermission = {
  [K in ScopedBase]: `${K}.${(typeof SCOPED_PERMISSIONS)[K][number]}`;
}[ScopedBase];
export type FlagPermission = (typeof FLAG_PERMISSIONS)[number];
export type Permission = ScopedPermission | FlagPermission;

/** Actions that must write an audit_logs row (SOP: Role-based access control). */
export const AUDITED_PERMISSIONS: ReadonlySet<string> = new Set([
  "recordings.play",
  "recordings.download",
  "leads.export",
  "leads.status_override",
  "voice_profiles.manage",
  "users.write",
  "audit.read",
  "projects.delete",
]);
