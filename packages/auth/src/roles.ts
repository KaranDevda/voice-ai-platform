import type { Permission } from "./permissions";

export const ROLE_KEYS = ["super_admin", "org_admin", "manager", "agent", "qa_auditor", "viewer"] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Seed data for roles.permissions; transcribed from the SOP permission matrix. */
export const ROLE_PERMISSIONS: Record<RoleKey, readonly Permission[]> = {
  // All orgs. Recording access is granted here but authorize() additionally demands a break-glass reason.
  super_admin: [
    "platform.admin",
    "leads.read.all",
    "leads.write.all",
    "leads.assign.all",
    "leads.status_override.all",
    "calls.read.all",
    "recordings.play.all",
    "recordings.download.all",
    "transcripts.read.all",
    "users.read.all",
    "users.write",
    "devices.revoke.all",
    "reports.read.all",
    "audit.read",
    "org_settings.read",
    "org_settings.write",
  ],
  org_admin: [
    "leads.read.all",
    "leads.write.all",
    "leads.assign.all",
    "leads.export.all",
    "leads.status_override.all",
    "leads.pii.read",
    "calls.read.all",
    "calls.place",
    "recordings.play.all",
    "recordings.download.all",
    "transcripts.read.all",
    "voice_profiles.manage",
    "kb.read",
    "kb.write",
    "ai_prompts.read",
    "ai_prompts.write",
    "users.read.all",
    "users.write",
    "devices.revoke.all",
    "reports.read.all",
    "audit.read",
    "org_settings.read",
    "org_settings.write",
  ],
  manager: [
    "leads.read.team",
    "leads.write.team",
    "leads.assign.team",
    "leads.export.team",
    "leads.status_override.team",
    "leads.pii.read",
    "calls.read.team",
    "calls.place",
    "recordings.play.team",
    "transcripts.read.team",
    "kb.read",
    "ai_prompts.read",
    "users.read.team",
    "devices.revoke.team",
    "reports.read.team",
  ],
  agent: [
    "leads.read.own",
    "leads.write.own",
    "leads.status_override.own",
    "leads.pii.read",
    "calls.read.own",
    "calls.place",
    "recordings.play.own",
    "transcripts.read.own",
    "reports.read.own",
  ],
  // The SOP matrix does not say whether QA sees unmasked numbers; granted because QA reviews calls
  // against real leads. Confirm with the client.
  qa_auditor: [
    "leads.read.team",
    "leads.pii.read",
    "calls.read.team",
    "recordings.play.team",
    "transcripts.read.team",
    "reports.read.team",
  ],
  // Aggregates only: no PII, no recordings, no record-level reads.
  viewer: ["calls.read.aggregate", "reports.read.aggregate"],
};

/** Roles that must enrol TOTP 2FA (SOP: Authentication). */
export const MFA_REQUIRED_ROLES: readonly RoleKey[] = ["org_admin", "manager", "qa_auditor"];
