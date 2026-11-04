import { and, desc, eq, inArray, sql } from "drizzle-orm";
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
    .where(and(visible, eq(leads.dndFlag, false), sql`${leads.consentStatus} not in ('denied','withdrawn')`, sql`${leads.tags} && ${tags}::text[]`)).limit(5001);
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

// ------------------------------------------------------------------------------------------ sequences

export interface SequenceInput { name: string; steps: { delayMin: number; body: string; dltTemplateId?: string | null }[] }

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
    return rows.map((r) => ({ ...r, steps: steps.filter((s) => s.sequenceId === r.id).map((s) => ({ delayMin: s.delayMin, body: s.body })), counts: Object.fromEntries(counts.filter((c) => c.sequenceId === r.id).map((c) => [c.status, c.n])) as Record<string, number> }));
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
