import { eq } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import {
  callBlockReason, orgSettingsSchema, type CallBlockReason, type CallSource, type TranscriptSegment,
} from "@voiceai/shared";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { callLogs, callTranscripts, leads, organizations, users } from "./schema";

export interface SaveCallInput {
  /** Unique per call; saving the same call twice changes nothing (a retry after a dropped connection is safe). */
  providerCallUuid: string;
  direction: "inbound" | "outbound";
  source: CallSource;
  startedAt: Date;
  durationS: number;
  segments: TranscriptSegment[];
  language: string;
  leadId?: string | null;
  voiceProfileId?: string | null;
  /** Set when the AI asked for a person to take over: why, and what the caller said. */
  handoff?: { reason: string };
}

/**
 * Saves a finished call: the call log, its transcript, and an audit entry when a person was asked for. A call where the
 * caller never said anything is saved as missed.
 */
export async function saveAiCall(db: Db, actor: AuthUser, input: SaveCallInput): Promise<{ id: string; created: boolean }> {
  assertAuthorized(actor, "calls.place");
  const spoke = input.segments.some((s) => s.speaker === "caller");
  return withOrg(db, actor.orgId, async (tx) => {
    const [owner] = await tx.select({ teamId: users.teamId }).from(users).where(eq(users.id, actor.id));
    const [row] = await tx
      .insert(callLogs)
      .values({
        orgId: actor.orgId, teamId: owner?.teamId ?? null, leadId: input.leadId ?? null, agentUserId: null, voiceProfileId: input.voiceProfileId ?? null,
        direction: input.direction, source: input.source, status: spoke ? "connected" : "missed",
        startedAt: input.startedAt, durationS: Math.max(0, Math.round(input.durationS)), providerCallUuid: input.providerCallUuid,
      })
      .onConflictDoNothing({ target: callLogs.providerCallUuid })
      .returning({ id: callLogs.id });
    if (!row) {
      const [existing] = await tx.select({ id: callLogs.id }).from(callLogs).where(eq(callLogs.providerCallUuid, input.providerCallUuid));
      return { id: existing!.id, created: false };
    }
    await tx.insert(callTranscripts).values({ callLogId: row.id, orgId: actor.orgId, teamId: owner?.teamId ?? null, segments: input.segments, language: input.language });
    if (input.handoff) {
      await writeAudit(tx, { orgId: actor.orgId, teamId: owner?.teamId, actorUserId: actor.id, action: "call.handoff_requested", entity: "call_logs", entityId: row.id, after: { reason: input.handoff.reason } });
    }
    return { id: row.id, created: true };
  });
}

export type OutboundCheck = { allowed: true } | { allowed: false; reason: CallBlockReason };

/**
 * The checks before any outbound call: Do Not Disturb, consent, and the calling hours in India. A blocked attempt is
 * written to the audit log, because an attempt to call a person who must not be called is itself worth knowing about.
 */
export async function checkOutboundCall(db: Db, actor: AuthUser, leadId: string, now = new Date()): Promise<OutboundCheck> {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, async (tx) => {
    const [lead] = await tx.select({ dndFlag: leads.dndFlag, consentStatus: leads.consentStatus }).from(leads).where(eq(leads.id, leadId));
    // A lead that is missing, or in another organisation, looks the same: it cannot be called.
    if (!lead) return { allowed: false, reason: "unknown_lead" } as const;
    const [org] = await tx.select({ s: organizations.settingsJson }).from(organizations).where(eq(organizations.id, actor.orgId));
    const reason = callBlockReason(lead, orgSettingsSchema.parse(org!.s).calling, now);
    if (!reason) return { allowed: true } as const;
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "call.blocked", entity: "leads", entityId: leadId, after: { reason } });
    return { allowed: false, reason } as const;
  });
}

/** The phone number of a lead the person may call, or null when there is no such lead (or it is in another organisation). */
export async function getLeadPhone(db: Db, actor: AuthUser, leadId: string): Promise<string | null> {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, async (tx) => (await tx.select({ phone: leads.phoneE164 }).from(leads).where(eq(leads.id, leadId)))[0]?.phone ?? null);
}

/** The lead with this phone number (already in +91... form), so an incoming call is filed under the right person. Null when unknown. */
export async function findLeadIdByPhone(db: Db, actor: AuthUser, e164: string): Promise<string | null> {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, async (tx) => (await tx.select({ id: leads.id }).from(leads).where(eq(leads.phoneE164, e164)))[0]?.id ?? null);
}
