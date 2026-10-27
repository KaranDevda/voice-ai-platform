import { and, eq, isNotNull, sql } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { decideStatusChange, type CallAnalysis, type LeadStatus, type TranscriptSegment } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { callAnalysisAttempts, callInsights, callLogs, callTranscripts, leadStatusHistory, leads } from "./schema";

export interface PendingCall { callLogId: string; orgId: string }

/** The next calls that have a transcript but no insights yet, across all organisations (see worker_pending_analysis in migration 0007). */
export async function listPendingAnalysis(db: Db, limit = 5): Promise<PendingCall[]> {
  const r = await db.execute<{ call_log_id: string; org_id: string }>(sql`select * from worker_pending_analysis(${limit})`);
  return r.rows.map((x) => ({ callLogId: x.call_log_id, orgId: x.org_id }));
}

export interface CallToAnalyze {
  id: string; orgId: string; language: string; durationS: number; direction: string; source: string;
  leadName: string | null; leadStatus: LeadStatus | null; segments: TranscriptSegment[];
}

export async function loadCallForAnalysis(db: Db, p: PendingCall): Promise<CallToAnalyze | null> {
  return withOrg(db, p.orgId, async (tx) => {
    const [row] = await tx
      .select({ id: callLogs.id, orgId: callLogs.orgId, durationS: callLogs.durationS, direction: callLogs.direction, source: callLogs.source, leadName: leads.name, leadStatus: leads.status, segments: callTranscripts.segments, language: callTranscripts.language })
      .from(callLogs)
      .innerJoin(callTranscripts, eq(callTranscripts.callLogId, callLogs.id))
      .leftJoin(leads, eq(leads.id, callLogs.leadId))
      .where(eq(callLogs.id, p.callLogId));
    return row ? { ...row, leadStatus: row.leadStatus ?? null } : null;
  });
}

export type StatusOutcome = "applied" | "queued" | "none";

/**
 * Saves the analysis and applies the automatic rules, all in one transaction: the insight, a status change when the AI is confident
 * enough (and the status is one it may set), and Do Not Disturb when the caller clearly asked not to be called again. Safe to run twice:
 * a call that already has insights is left alone.
 */
export async function saveAnalysis(db: Db, p: PendingCall, a: CallAnalysis, modelVersion: string): Promise<{ saved: boolean; status: StatusOutcome; dndSet: boolean; rerun?: boolean }> {
  return withOrg(db, p.orgId, async (tx) => {
    const [call] = await tx.select({ id: callLogs.id, teamId: callLogs.teamId, leadId: callLogs.leadId }).from(callLogs).where(eq(callLogs.id, p.callLogId));
    if (!call) return { saved: false, status: "none", dndSet: false };
    const [attempt] = await tx.select({ rerun: callAnalysisAttempts.rerun }).from(callAnalysisAttempts).where(eq(callAnalysisAttempts.callLogId, call.id));
    if (attempt?.rerun) {
      // A person asked for a fresh analysis. The new answer replaces the old one, but the rules do NOT run again: a status or Do Not Disturb
      // set the first time (or changed by a person since) is not touched, and a different suggestion waits for the owner to confirm.
      await tx.insert(callInsights).values({
        callLogId: call.id, orgId: p.orgId, teamId: call.teamId, summary: a.summary, sentimentScore: a.sentimentScore, sentimentLabel: a.sentimentLabel,
        intent: a.intent, nextAction: a.nextAction, suggestedStatus: a.suggestedStatus, suggestedStatusConfidence: a.confidence, modelVersion,
      }).onConflictDoUpdate({ target: callInsights.callLogId, set: { summary: a.summary, sentimentScore: a.sentimentScore, sentimentLabel: a.sentimentLabel, intent: a.intent, nextAction: a.nextAction, suggestedStatus: a.suggestedStatus, suggestedStatusConfidence: a.confidence, modelVersion, createdAt: new Date() } });
      await tx.delete(callAnalysisAttempts).where(eq(callAnalysisAttempts.callLogId, call.id));
      return { saved: true, status: "none", dndSet: false, rerun: true };
    }
    const inserted = await tx.insert(callInsights).values({
      callLogId: call.id, orgId: p.orgId, teamId: call.teamId, summary: a.summary, sentimentScore: a.sentimentScore, sentimentLabel: a.sentimentLabel,
      intent: a.intent, nextAction: a.nextAction, suggestedStatus: a.suggestedStatus, suggestedStatusConfidence: a.confidence, modelVersion,
    }).onConflictDoNothing().returning({ id: callInsights.callLogId });
    if (!inserted.length) return { saved: false, status: "none", dndSet: false };
    await tx.delete(callAnalysisAttempts).where(eq(callAnalysisAttempts.callLogId, call.id));

    let status: StatusOutcome = "none", dndSet = false;
    if (call.leadId) {
      const [lead] = await tx.select({ status: leads.status, dnd: leads.dndFlag, teamId: leads.teamId }).from(leads).where(eq(leads.id, call.leadId)).for("update");
      if (lead) {
        const decision = decideStatusChange({ current: lead.status, suggested: a.suggestedStatus, confidence: a.confidence });
        if (decision === "apply" && a.suggestedStatus) {
          await tx.update(leads).set({ status: a.suggestedStatus }).where(eq(leads.id, call.leadId));
          await tx.insert(leadStatusHistory).values({ orgId: p.orgId, teamId: lead.teamId, leadId: call.leadId, fromStatus: lead.status, toStatus: a.suggestedStatus, changedBy: "ai", reason: `After a call: ${a.intent ?? "see the call summary"}`, confidence: a.confidence, callLogId: call.id });
          await writeAudit(tx, { orgId: p.orgId, teamId: lead.teamId, action: "lead.status_auto", entity: "leads", entityId: call.leadId, before: { status: lead.status }, after: { status: a.suggestedStatus, confidence: a.confidence, callLogId: call.id } });
          status = "applied";
        } else if (decision === "queue") status = "queued";
        // Only ever towards MORE protection: the AI can switch Do Not Disturb on, never off.
        if (a.doNotCall && !lead.dnd) {
          await tx.update(leads).set({ dndFlag: true }).where(eq(leads.id, call.leadId));
          await writeAudit(tx, { orgId: p.orgId, teamId: lead.teamId, action: "lead.dnd_auto_set", entity: "leads", entityId: call.leadId, after: { callLogId: call.id, reason: "caller asked not to be called again" } });
          dndSet = true;
        }
      }
    }
    return { saved: true, status, dndSet };
  });
}

/** Retry later with growing pauses (1, 2, 4, 8 minutes); after 5 failed tries the call is left alone. */
export async function recordAnalysisFailure(db: Db, p: PendingCall, error: string, now = new Date()): Promise<void> {
  await withOrg(db, p.orgId, async (tx) => {
    const [cur] = await tx.select({ attempts: callAnalysisAttempts.attempts }).from(callAnalysisAttempts).where(eq(callAnalysisAttempts.callLogId, p.callLogId));
    const attempts = (cur?.attempts ?? 0) + 1;
    const nextTryAt = new Date(now.getTime() + 60_000 * 2 ** (attempts - 1));
    await tx.insert(callAnalysisAttempts).values({ callLogId: p.callLogId, orgId: p.orgId, attempts, lastError: error.slice(0, 300), nextTryAt, updatedAt: now })
      .onConflictDoUpdate({ target: callAnalysisAttempts.callLogId, set: { attempts, lastError: error.slice(0, 300), nextTryAt, updatedAt: now } });
  });
}

/**
 * The owner confirms the status the AI suggested but was not sure enough to apply. Needs the right to change this lead's status.
 * A person may also move a closed lead, which the AI never does by itself.
 */
export async function applySuggestedStatus(db: Db, user: AuthUser, callLogId: string): Promise<"applied" | "nothing_to_apply" | "not_found"> {
  return withOrg(db, user.orgId, async (tx) => {
    const [row] = await tx
      .select({ suggested: callInsights.suggestedStatus, confidence: callInsights.suggestedStatusConfidence, leadId: callLogs.leadId, status: leads.status, teamId: leads.teamId, ownerId: leads.ownerUserId, orgId: leads.orgId })
      .from(callInsights).innerJoin(callLogs, eq(callLogs.id, callInsights.callLogId)).innerJoin(leads, eq(leads.id, callLogs.leadId)).where(eq(callInsights.callLogId, callLogId));
    if (!row?.leadId) return "not_found";
    assertAuthorized(user, "leads.status_override", { orgId: row.orgId, teamId: row.teamId, ownerUserId: row.ownerId });
    if (!row.suggested || row.suggested === row.status) return "nothing_to_apply";
    await tx.update(leads).set({ status: row.suggested }).where(eq(leads.id, row.leadId));
    await tx.insert(leadStatusHistory).values({ orgId: row.orgId, teamId: row.teamId, leadId: row.leadId, fromStatus: row.status, toStatus: row.suggested, changedBy: "user", changedByUserId: user.id, reason: "Confirmed the status the AI suggested", confidence: row.confidence, callLogId });
    await writeAudit(tx, { orgId: row.orgId, teamId: row.teamId, actorUserId: user.id, action: "lead.status_confirmed", entity: "leads", entityId: row.leadId, before: { status: row.status }, after: { status: row.suggested, callLogId } });
    return "applied";
  });
}

/**
 * A person asks for a call's analysis to run again (it failed, or they want a fresh answer). Needs the right to read that call's transcript.
 * A call that failed is analysed like a new one; a call that already has insights is re-analysed without touching the lead (see saveAnalysis).
 */
export async function requeueAnalysis(db: Db, user: AuthUser, callLogId: string, now = new Date()): Promise<"queued" | "no_transcript" | "not_found"> {
  return withOrg(db, user.orgId, async (tx) => {
    const [c] = await tx.select({ orgId: callLogs.orgId, teamId: callLogs.teamId, agentUserId: callLogs.agentUserId }).from(callLogs).where(eq(callLogs.id, callLogId));
    if (!c) return "not_found";
    assertAuthorized(user, "transcripts.read", { orgId: c.orgId, teamId: c.teamId, ownerUserId: c.agentUserId });
    const [t] = await tx.select({ id: callTranscripts.callLogId }).from(callTranscripts).where(eq(callTranscripts.callLogId, callLogId));
    if (!t) return "no_transcript";
    const [i] = await tx.select({ id: callInsights.callLogId }).from(callInsights).where(eq(callInsights.callLogId, callLogId));
    await tx.insert(callAnalysisAttempts).values({ callLogId, orgId: user.orgId, attempts: 0, lastError: null, nextTryAt: now, rerun: !!i, updatedAt: now })
      .onConflictDoUpdate({ target: callAnalysisAttempts.callLogId, set: { attempts: 0, lastError: null, nextTryAt: now, rerun: !!i, updatedAt: now } });
    await writeAudit(tx, { orgId: user.orgId, teamId: c.teamId, actorUserId: user.id, action: "call.analysis_requeued", entity: "call_logs", entityId: callLogId });
    return "queued";
  });
}

/** How many calls the AI gave up analysing (five failed tries, no insights), among the calls this person may see. */
export async function countFailedAnalyses(db: Db, user: AuthUser): Promise<number> {
  const r = await withOrg(db, user.orgId, (tx) => tx.execute<{ n: string }>(sql`select count(*)::text as n from call_analysis_attempts a where a.attempts >= 5 and not exists (select 1 from call_insights i where i.call_log_id = a.call_log_id)`));
  return Number(r.rows[0]?.n ?? 0);
}

// --------------------------------------------------------------------------------------------- retention

export interface ExpiredRecording extends PendingCall { recordingKey: string }

export async function listExpiredRecordings(db: Db, limit = 100): Promise<ExpiredRecording[]> {
  const r = await db.execute<{ call_log_id: string; org_id: string; recording_key: string }>(sql`select * from worker_expired_recordings(${limit})`);
  return r.rows.map((x) => ({ callLogId: x.call_log_id, orgId: x.org_id, recordingKey: x.recording_key }));
}

/** Forgets a recording that has passed its organisation's retention period (the caller deletes the file first). Audited with no content. */
export async function purgeRecording(db: Db, p: ExpiredRecording): Promise<boolean> {
  return withOrg(db, p.orgId, async (tx) => {
    const done = await tx.update(callLogs).set({ recordingKey: null }).where(and(eq(callLogs.id, p.callLogId), isNotNull(callLogs.recordingKey))).returning({ id: callLogs.id });
    if (done.length) await writeAudit(tx, { orgId: p.orgId, action: "recording.purged", entity: "call_logs", entityId: p.callLogId, after: { reason: "retention period ended" } });
    return done.length > 0;
  });
}

export async function listExpiredTranscripts(db: Db, limit = 100): Promise<PendingCall[]> {
  const r = await db.execute<{ call_log_id: string; org_id: string }>(sql`select * from worker_expired_transcripts(${limit})`);
  return r.rows.map((x) => ({ callLogId: x.call_log_id, orgId: x.org_id }));
}

/**
 * Deletes a call's transcript and AI insights once the data retention period has passed. The call itself (when, how long, who, outcome)
 * stays, so reports and the lead's history keep their numbers; only the words are gone.
 */
export async function purgeTranscript(db: Db, p: PendingCall): Promise<boolean> {
  return withOrg(db, p.orgId, async (tx) => {
    const t = await tx.delete(callTranscripts).where(eq(callTranscripts.callLogId, p.callLogId)).returning({ id: callTranscripts.callLogId });
    const i = await tx.delete(callInsights).where(eq(callInsights.callLogId, p.callLogId)).returning({ id: callInsights.callLogId });
    await tx.delete(callAnalysisAttempts).where(eq(callAnalysisAttempts.callLogId, p.callLogId));
    if (t.length || i.length) await writeAudit(tx, { orgId: p.orgId, action: "transcript.purged", entity: "call_logs", entityId: p.callLogId, after: { reason: "data retention period ended" } });
    return t.length > 0 || i.length > 0;
  });
}
