import { textArray } from "./sql-array";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { maskPhone } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { assertCredit } from "./billing";
import { assertKyc } from "./platform-admin";
import { withOrg, type Db } from "./client";
import { scopeCondition } from "./scoped";
import { leads, sequenceEnrollments, sequences, sequenceSteps, smsMessages, smsTemplates } from "./schema";

export class MessagingError extends Error {}

const clean = (s: string) => s.normalize("NFC").replace(/\r\n/g, "\n").trim();
const checkBody = (body: string) => { if (!body) throw new MessagingError("write the message"); if (body.length > 1000) throw new MessagingError("the message can be at most 1000 characters"); };
const dlt = (v?: string | null) => { const t = (v ?? "").trim(); if (t && !/^[0-9]{6,30}$/.test(t)) throw new MessagingError("a DLT template ID is digits only"); return t || null; };

/** People the actor may see, with one of the tags, who may be messaged (not Do Not Disturb, consent not denied or withdrawn). */
async function reachableByTags(tx: Parameters<Parameters<typeof withOrg>[2]>[0], actor: AuthUser, tags: string[]) {
  if (tags.length === 0) throw new MessagingError("choose at least one tag");
  const visible = scopeCondition(actor, "leads.read", { orgId: leads.orgId, teamId: leads.teamId, ownerUserId: leads.ownerUserId });
  const people = await tx.select({ id: leads.id }).from(leads)
    .where(and(visible, eq(leads.dndFlag, false), sql`${leads.consentStatus} not in ('denied','withdrawn')`, sql`${leads.tags} && ${textArray(tags)}`)).limit(5001);
  if (people.length === 0) throw new MessagingError("nobody with those tags can be messaged (check the tags, Do Not Disturb and consent)");
  if (people.length > 5000) throw new MessagingError("at most 5000 people at a time; use a narrower tag");
  return people.map((p) => p.id);
}

/**
 * Queues one text to everyone with the tags. The worker sends it, only inside the calling hours and never to a person who is on Do Not
 * Disturb or has no consent (checked again at send time).
 */
export async function queueSmsToTags(db: Db, actor: AuthUser, input: { tags: string[]; body: string; dltTemplateId?: string | null }) {
  assertAuthorized(actor, "calls.place");
  const body = clean(input.body); checkBody(body);
  const dltTemplateId = dlt(input.dltTemplateId);
  return withOrg(db, actor.orgId, async (tx) => {
    await assertKyc(tx, actor.orgId);
    await assertCredit(tx, actor.orgId);
    const ids = await reachableByTags(tx, actor, input.tags);
    for (let i = 0; i < ids.length; i += 500) await tx.insert(smsMessages).values(ids.slice(i, i + 500).map((leadId) => ({ orgId: actor.orgId, leadId, direction: "outbound" as const, body, dltTemplateId, createdBy: actor.id })));
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "sms.queue", entity: "sms_messages", after: { people: ids.length, tags: input.tags } });
    return { queued: ids.length };
  });
}

/** One text to one lead. */
export async function queueSmsToLead(db: Db, actor: AuthUser, input: { leadId: string; body: string; dltTemplateId?: string | null }) {
  assertAuthorized(actor, "calls.place");
  const body = clean(input.body); checkBody(body);
  const dltTemplateId = dlt(input.dltTemplateId);
  return withOrg(db, actor.orgId, async (tx) => {
    const visible = scopeCondition(actor, "leads.read", { orgId: leads.orgId, teamId: leads.teamId, ownerUserId: leads.ownerUserId });
    const [lead] = await tx.select({ id: leads.id, dnd: leads.dndFlag, consent: leads.consentStatus }).from(leads).where(and(visible, eq(leads.id, input.leadId)));
    await assertKyc(tx, actor.orgId);
    await assertCredit(tx, actor.orgId);
    if (!lead) throw new MessagingError("lead not found");
    if (lead.dnd) throw new MessagingError("this number is on Do Not Disturb, so it cannot be messaged");
    if (lead.consent === "denied" || lead.consent === "withdrawn") throw new MessagingError("this person has no consent to be messaged");
    await tx.insert(smsMessages).values({ orgId: actor.orgId, leadId: lead.id, direction: "outbound", body, dltTemplateId, createdBy: actor.id });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "sms.queue", entity: "leads", entityId: lead.id });
    return { queued: 1 };
  });
}

export async function listSms(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "calls.place");
  const showPhone = actor.permissions.includes("leads.pii.read");
  return withOrg(db, actor.orgId, async (tx) => {
    const rows = await tx.select({ id: smsMessages.id, direction: smsMessages.direction, body: smsMessages.body, status: smsMessages.status, error: smsMessages.error, createdAt: smsMessages.createdAt, name: leads.name, phone: leads.phoneE164 })
      .from(smsMessages).leftJoin(leads, eq(leads.id, smsMessages.leadId)).orderBy(desc(smsMessages.createdAt)).limit(100);
    const counts = await tx.select({ status: smsMessages.status, n: sql<number>`count(*)::int` }).from(smsMessages).groupBy(smsMessages.status);
    return { rows: rows.map((r) => ({ ...r, phone: r.phone ? (showPhone ? r.phone : maskPhone(r.phone)) : null })), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Record<string, number> };
  });
}

/** Complete two-way SMS history for one visible lead, oldest first. */
export async function listSmsForLead(db: Db, actor: AuthUser, leadId: string) {
  assertAuthorized(actor, "calls.place");
  const visible = scopeCondition(actor, "leads.read", { orgId: leads.orgId, teamId: leads.teamId, ownerUserId: leads.ownerUserId });
  return withOrg(db, actor.orgId, async (tx) => tx.select({ id: smsMessages.id, direction: smsMessages.direction, body: smsMessages.body, status: smsMessages.status, error: smsMessages.error, createdAt: smsMessages.createdAt })
    .from(smsMessages).innerJoin(leads, eq(leads.id, smsMessages.leadId)).where(and(visible, eq(smsMessages.leadId, leadId))).orderBy(asc(smsMessages.createdAt)));
}

// ------------------------------------------------------------------------------------------ sequences

export interface SequenceInput { name: string; steps: { delayMin: number; body: string; dltTemplateId?: string | null }[] }

export interface StepProgress {
  step: number;
  queued: number;
  sent: number;
  failed: number;
  waiting: number;
  /** Inbound replies attributed to this step's message. */
  replies: number;
  /** replies / sent for the step, as a percentage with one decimal. */
  responseRate: number;
}

/**
 * Deterministic reply attribution rule (applied by the SQL in listSequences):
 * an inbound reply is credited to the step of the most recently sent sequenced
 * outbound text to that lead (latest sent_at, then created_at, then message id),
 * across all of the lead's active sequences. A lead enrolled in several sequences
 * at once therefore gets exactly one attribution per reply. Replies with no prior
 * sent sequenced outbound message are unattributed and counted nowhere per-step.
 */
export function sequenceStepProgress(
  stepCount: number,
  enrollmentCounts: { nextStep: number; count: number }[],
  stepMessages: { stepPosition: number; status: string; count: number }[],
  repliesByStep: Record<number, number> = {},
): StepProgress[] {
  return Array.from({ length: stepCount }, (_, index) => {
    const step = index + 1;
    const sent = stepMessages.filter((row) => row.stepPosition === index && row.status === "sent").reduce((total, row) => total + row.count, 0);
    const replies = repliesByStep[step] ?? 0;
    return {
      step,
      queued: enrollmentCounts.reduce((total, row) => total + (row.nextStep > index ? row.count : 0), 0),
      sent,
      failed: stepMessages.filter((row) => row.stepPosition === index && row.status === "failed").reduce((total, row) => total + row.count, 0),
      waiting: stepMessages.filter((row) => row.stepPosition === index && (row.status === "queued" || row.status === "sending")).reduce((total, row) => total + row.count, 0),
      replies,
      responseRate: sent ? Math.round((replies / sent) * 1000) / 10 : 0,
    };
  });
}

/** A multi-step follow-up: each step is a text sent some minutes after the one before (the first, after enrolling). */
export async function createSequence(db: Db, actor: AuthUser, input: SequenceInput) {
  assertAuthorized(actor, "calls.place");
  const name = clean(input.name).replace(/\s+/g, " ");
  if (!name || name.length > 120) throw new MessagingError("enter a name of up to 120 characters");
  if (input.steps.length < 1 || input.steps.length > 10) throw new MessagingError("a sequence has 1 to 10 steps");
  const steps = input.steps.map((s, i) => {
    const body = clean(s.body); checkBody(body);
    if (!Number.isInteger(s.delayMin) || s.delayMin < 0 || s.delayMin > 43200) throw new MessagingError(`step ${i + 1}: the wait must be 0 to 43200 minutes`);
    return { delayMin: s.delayMin, body, dltTemplateId: dlt(s.dltTemplateId) };
  });
  return withOrg(db, actor.orgId, async (tx) => {
    const [q] = await tx.insert(sequences).values({ orgId: actor.orgId, name, createdBy: actor.id }).returning();
    await tx.insert(sequenceSteps).values(steps.map((s, position) => ({ orgId: actor.orgId, sequenceId: q!.id, position, ...s })));
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "sequence.create", entity: "sequences", entityId: q!.id, after: { name, steps: steps.length } });
    return q!;
  });
}

export async function listSequences(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, async (tx) => {
    const rows = await tx.select().from(sequences).orderBy(desc(sequences.createdAt)).limit(100);
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const steps = await tx.select().from(sequenceSteps).where(inArray(sequenceSteps.sequenceId, ids)).orderBy(sequenceSteps.position);
    const counts = await tx.select({ sequenceId: sequenceEnrollments.sequenceId, status: sequenceEnrollments.status, n: sql<number>`count(*)::int` }).from(sequenceEnrollments).where(inArray(sequenceEnrollments.sequenceId, ids)).groupBy(sequenceEnrollments.sequenceId, sequenceEnrollments.status);
    const progress = await tx.select({ sequenceId: sequenceEnrollments.sequenceId, nextStep: sequenceEnrollments.nextStep, count: sql<number>`count(*)::int` })
      .from(sequenceEnrollments).where(inArray(sequenceEnrollments.sequenceId, ids)).groupBy(sequenceEnrollments.sequenceId, sequenceEnrollments.nextStep);
    const messageCounts = await tx.select({ sequenceId: sequenceEnrollments.sequenceId, status: smsMessages.status, count: sql<number>`count(*)::int` })
      .from(smsMessages).innerJoin(sequenceEnrollments, eq(smsMessages.enrollmentId, sequenceEnrollments.id))
      .where(inArray(sequenceEnrollments.sequenceId, ids)).groupBy(sequenceEnrollments.sequenceId, smsMessages.status);
    const trackingColumn = await tx.execute<{ enabled: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'sms_messages' AND column_name = 'sequence_step_position'
      ) AS enabled
    `);
    const stepTrackingEnabled = trackingColumn.rows[0]?.enabled === true;
    const stepMessages = stepTrackingEnabled
      ? await tx.select({ sequenceId: sequenceEnrollments.sequenceId, stepPosition: smsMessages.sequenceStepPosition, status: smsMessages.status, count: sql<number>`count(*)::int` })
        .from(smsMessages).innerJoin(sequenceEnrollments, eq(smsMessages.enrollmentId, sequenceEnrollments.id))
        .where(and(inArray(sequenceEnrollments.sequenceId, ids), isNotNull(smsMessages.sequenceStepPosition)))
        .groupBy(sequenceEnrollments.sequenceId, smsMessages.sequenceStepPosition, smsMessages.status)
      : [];
    /** Replies attributed per (sequence, step): an inbound reply is credited to the step of the most recent
     *  sent sequenced outbound text to that lead, across all of that lead's sequences. Only available once
     *  migration 0036 added sequence_step_position to sms_messages. */
    const stepRepliesRows: { sequence_id: string; step_position: number; replies: number }[] = stepTrackingEnabled
      ? (await tx.execute<{ sequence_id: string; step_position: number; replies: number }>(sql`
          WITH attributed AS (
            SELECT m.id AS inbound_id,
              (SELECT o.id
                 FROM sms_messages o
                WHERE o.lead_id = m.lead_id
                  AND o.direction = 'outbound'
                  AND o.status = 'sent'
                  AND o.enrollment_id IS NOT NULL
                  AND o.sequence_step_position IS NOT NULL
                  AND o.org_id = m.org_id
                ORDER BY o.sent_at DESC NULLS LAST, o.created_at DESC, o.id DESC
                LIMIT 1) AS attributed_message_id
              FROM sms_messages m
             WHERE m.direction = 'inbound' AND m.status = 'received'
          )
          SELECT e.sequence_id, o.sequence_step_position AS step_position, count(*)::int AS replies
            FROM attributed a
            JOIN sms_messages o ON o.id = a.attributed_message_id
            JOIN sequence_enrollments e ON e.id = o.enrollment_id
           WHERE a.attributed_message_id IS NOT NULL
           GROUP BY e.sequence_id, o.sequence_step_position
        `)).rows
      : [];
    return rows.map((r) => {
      const sequenceStepsForRow = steps.filter((s) => s.sequenceId === r.id);
      const repliesByStep: Record<number, number> = {};
      for (const row of stepRepliesRows.filter((row) => row.sequence_id === r.id)) {
        repliesByStep[row.step_position] = (repliesByStep[row.step_position] ?? 0) + Number(row.replies);
      }
      return {
        ...r,
        steps: sequenceStepsForRow.map((s) => ({ delayMin: s.delayMin, body: s.body })),
        counts: Object.fromEntries(counts.filter((c) => c.sequenceId === r.id).map((c) => [c.status, c.n])) as Record<string, number>,
        stepProgress: sequenceStepProgress(
          sequenceStepsForRow.length,
          progress.filter((p) => p.sequenceId === r.id),
          stepMessages.filter((p) => p.sequenceId === r.id).map((p) => ({ stepPosition: p.stepPosition!, status: p.status, count: p.count })),
          repliesByStep,
        ),
        stepTrackingEnabled,
        messageCounts: Object.fromEntries(messageCounts.filter((c) => c.sequenceId === r.id).map((c) => [c.status, c.count])) as Record<string, number>,
      };
    });
  });
}

/** Enrols everyone with the tags (people already in it are left as they are). */
export async function enrollTags(db: Db, actor: AuthUser, sequenceId: string, tags: string[]) {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, async (tx) => {
    const [q] = await tx.select().from(sequences).where(eq(sequences.id, sequenceId));
    if (!q || q.status !== "active") throw new MessagingError("sequence not found");
    await assertKyc(tx, actor.orgId);
    const ids = await reachableByTags(tx, actor, tags);
    let added = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const r = await tx.insert(sequenceEnrollments).values(ids.slice(i, i + 500).map((leadId) => ({ orgId: actor.orgId, sequenceId, leadId }))).onConflictDoNothing().returning({ id: sequenceEnrollments.id });
      added += r.length;
    }
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "sequence.enroll", entity: "sequences", entityId: sequenceId, after: { added, tags } });
    return { added, alreadyIn: ids.length - added };
  });
}

/** Enrols one visible, reachable lead in an active sequence. */
export async function enrollLead(db: Db, actor: AuthUser, sequenceId: string, leadId: string) {
  assertAuthorized(actor, "calls.place");
  const visible = scopeCondition(actor, "leads.read", { orgId: leads.orgId, teamId: leads.teamId, ownerUserId: leads.ownerUserId });
  return withOrg(db, actor.orgId, async (tx) => {
    const [q] = await tx.select({ id: sequences.id }).from(sequences).where(and(eq(sequences.id, sequenceId), eq(sequences.status, "active")));
    if (!q) throw new MessagingError("active sequence not found");
    await assertKyc(tx, actor.orgId);
    const [lead] = await tx.select({ id: leads.id, dnd: leads.dndFlag, consent: leads.consentStatus }).from(leads).where(and(visible, eq(leads.id, leadId)));
    if (!lead) throw new MessagingError("lead not found");
    if (lead.dnd) throw new MessagingError("this number is on Do Not Disturb and cannot be enrolled");
    if (lead.consent === "denied" || lead.consent === "withdrawn") throw new MessagingError("this person has no consent to be messaged");
    const inserted = await tx.insert(sequenceEnrollments).values({ orgId: actor.orgId, sequenceId, leadId }).onConflictDoNothing().returning({ id: sequenceEnrollments.id });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "sequence.enroll", entity: "sequences", entityId: sequenceId, after: { added: inserted.length, leadId } });
    return { added: inserted.length, alreadyIn: inserted.length ? 0 : 1 };
  });
}

/** Pause, resume or stop everyone in a sequence, or archive it (which also stops them). */
export async function updateSequence(db: Db, actor: AuthUser, sequenceId: string, action: "pause" | "resume" | "stop" | "archive") {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, async (tx) => {
    const [q] = await tx.select().from(sequences).where(eq(sequences.id, sequenceId));
    if (!q) throw new MessagingError("sequence not found");
    if (action === "pause") await tx.update(sequenceEnrollments).set({ status: "paused" }).where(and(eq(sequenceEnrollments.sequenceId, sequenceId), eq(sequenceEnrollments.status, "active")));
    if (action === "resume") await tx.update(sequenceEnrollments).set({ status: "active" }).where(and(eq(sequenceEnrollments.sequenceId, sequenceId), eq(sequenceEnrollments.status, "paused")));
    if (action === "stop" || action === "archive") await tx.update(sequenceEnrollments).set({ status: "stopped" }).where(and(eq(sequenceEnrollments.sequenceId, sequenceId), inArray(sequenceEnrollments.status, ["active", "paused"])));
    if (action === "archive") await tx.update(sequences).set({ status: "archived" }).where(eq(sequences.id, sequenceId));
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: `sequence.${action}`, entity: "sequences", entityId: sequenceId });
    return { id: sequenceId, action };
  });
}

// ------------------------------------------------------------------------------------------ the sender (worker)

export interface SmsJob { id: string; orgId: string; phone: string; body: string; dltTemplateId: string | null; personName: string | null; personFields: Record<string, string> }

/** One round: follow-up steps that are due become queued texts, then the next queued texts (inside the calling hours) are handed out. Run by ONE worker. */
export async function smsRound(db: Db, limit = 20): Promise<SmsJob[]> {
  await db.execute(sql`select worker_sequence_tick(50)`);
  const r = await db.execute<{ id: string; org_id: string; phone: string; body: string; dlt_template_id: string | null; person_name: string | null; person_fields: Record<string, string> | null }>(sql`select * from worker_sms_claim(${limit})`);
  return r.rows.map((x) => ({ id: x.id, orgId: x.org_id, phone: x.phone, body: x.body, dltTemplateId: x.dlt_template_id, personName: x.person_name, personFields: x.person_fields ?? {} }));
}

export async function smsDone(db: Db, id: string, ok: boolean, providerUuid?: string, error?: string) {
  await db.execute(sql`select worker_sms_done(${id}::uuid, ${ok}, ${providerUuid ?? null}, ${error ?? null})`);
}

/** A text that came in (from the Plivo webhook). Returns the lead it was filed under. */
export async function recordInboundSms(db: Db, orgId: string, from: string, body: string): Promise<string> {
  const r = await db.execute<{ id: string }>(sql`select worker_sms_inbound(${orgId}::uuid, ${from}, ${body}) as id`);
  return r.rows[0]!.id;
}

// ------------------------------------------------------------------------------------------ templates

export async function listSmsTemplates(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, (tx) => tx.select({ id: smsTemplates.id, name: smsTemplates.name, body: smsTemplates.body, dltTemplateId: smsTemplates.dltTemplateId }).from(smsTemplates).orderBy(smsTemplates.name).limit(200));
}

/** Saves a template, or updates the one with the same name. */
export async function saveSmsTemplate(db: Db, actor: AuthUser, input: { name: string; body: string; dltTemplateId?: string | null }) {
  assertAuthorized(actor, "calls.place");
  const name = clean(input.name).replace(/\s+/g, " ");
  if (!name || name.length > 80) throw new MessagingError("enter a name of up to 80 characters");
  const body = clean(input.body); checkBody(body);
  const dltTemplateId = dlt(input.dltTemplateId);
  return withOrg(db, actor.orgId, async (tx) => {
    const [row] = await tx.insert(smsTemplates).values({ orgId: actor.orgId, name, body, dltTemplateId, createdBy: actor.id })
      .onConflictDoUpdate({ target: [smsTemplates.orgId, smsTemplates.name], set: { body, dltTemplateId } }).returning({ id: smsTemplates.id });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "sms_template.save", entity: "sms_templates", entityId: row!.id, after: { name } });
    return row!;
  });
}

export async function deleteSmsTemplate(db: Db, actor: AuthUser, id: string) {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, async (tx) => {
    const gone = await tx.delete(smsTemplates).where(eq(smsTemplates.id, id)).returning({ id: smsTemplates.id });
    if (!gone.length) throw new MessagingError("template not found");
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "sms_template.delete", entity: "sms_templates", entityId: id });
    return { id };
  });
}

/** True when this person was sent a text by the auto-reply (or anything) in the last `minutes`: stops two phones answering each other in a loop. */
export async function sentTextRecently(db: Db, actor: AuthUser, leadId: string, minutes = 10): Promise<boolean> {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, async (tx) => (await tx.select({ id: smsMessages.id }).from(smsMessages).where(and(eq(smsMessages.leadId, leadId), eq(smsMessages.direction, "outbound"), sql`${smsMessages.createdAt} > now() - make_interval(mins => ${minutes})`)).limit(1)).length > 0);
}
