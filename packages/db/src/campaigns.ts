import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { assertAuthorized, signVoiceToken, type AuthUser } from "@voiceai/auth";
import { maskPhone } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { assertKyc } from "./platform-admin";
import { withOrg, type Db } from "./client";
import { scopeCondition } from "./scoped";
import { textArray } from "./sql-array";
import { campaignAudio, campaignTemplates, campaigns, campaignTargets, leads, type CAMPAIGN_STATUSES } from "./schema";

export class CampaignError extends Error {}

export interface CampaignInput {
  name: string; language: "en" | "hi" | "en-hi"; voice?: string | null;
  /** Everyone with ANY of these tags is called. */
  tags: string[];
  startAt?: Date | null; maxConcurrent: number; maxAttempts: number; retryDelayMin: number;
  /** Hang up on answering machines (default on). */
  detectMachines?: boolean;
  /** "audio": play a recording (upload it after creating) instead of an AI conversation. */
  mode?: "ai" | "audio";
  /** A/B test: up to 3 opening lines, each person hears one. */
  openingVariants?: string[];
}

export interface CampaignTemplateInput {
  name: string; language: "en" | "hi" | "en-hi"; tags: string[]; maxConcurrent: number; maxAttempts: number;
  retryDelayMin: number; detectMachines: boolean; mode: "ai" | "audio"; openingVariants: string[];
}

const inRange = (v: number, lo: number, hi: number, what: string) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new CampaignError(`${what} must be a whole number from ${lo} to ${hi}`);
  return v;
};

/**
 * Makes a campaign from everyone (the person may see) who has one of the tags and is not on Do Not Disturb or without consent.
 * With a start time it waits for it ("scheduled"); without, it waits for Start ("draft"). Nobody is called until it runs.
 */
export async function createCampaign(db: Db, actor: AuthUser, input: CampaignInput) {
  assertAuthorized(actor, "calls.place");
  const name = input.name.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name || name.length > 120) throw new CampaignError("enter a name of up to 120 characters");
  if (input.tags.length === 0) throw new CampaignError("choose at least one tag: the campaign calls everyone with it");
  const maxConcurrent = inRange(input.maxConcurrent, 1, 20, "calls at once");
  const maxAttempts = inRange(input.maxAttempts, 1, 5, "tries per person");
  const retryDelayMin = inRange(input.retryDelayMin, 5, 1440, "minutes between tries");
  const openingVariants = (input.openingVariants ?? []).map((v) => v.normalize("NFC").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (openingVariants.length === 1) throw new CampaignError("an A/B test needs at least two opening lines (or leave them empty)");
  if (openingVariants.length > 3 || openingVariants.some((v) => v.length > 300)) throw new CampaignError("use up to 3 opening lines of up to 300 characters each");
  if (input.startAt && input.startAt.getTime() < Date.now() - 60_000) throw new CampaignError("the start time is in the past");
  return withOrg(db, actor.orgId, async (tx) => {
    const visible = scopeCondition(actor, "leads.read", { orgId: leads.orgId, teamId: leads.teamId, ownerUserId: leads.ownerUserId });
    const people = await tx.select({ id: leads.id }).from(leads)
      .where(and(visible, eq(leads.dndFlag, false), sql`${leads.consentStatus} not in ('denied','withdrawn')`, sql`${leads.tags} && ${textArray(input.tags)}`))
      .limit(5001);
    if (people.length === 0) throw new CampaignError("nobody with those tags can be called (check the tags, Do Not Disturb and consent)");
    if (people.length > 5000) throw new CampaignError("a campaign can have at most 5000 people; use a narrower tag");
    const [c] = await tx.insert(campaigns).values({
      orgId: actor.orgId, name, language: input.language, voice: input.voice || null, startAt: input.startAt ?? null,
      status: input.startAt ? "scheduled" : "draft", maxConcurrent, maxAttempts, retryDelayMin, createdBy: actor.id,
      detectMachines: input.detectMachines ?? true, openingVariants: input.mode === "audio" ? [] : openingVariants, mode: input.mode === "audio" ? "audio" : "ai",
    }).returning();
    for (let i = 0; i < people.length; i += 500) {
      await tx.insert(campaignTargets).values(people.slice(i, i + 500).map((p) => ({ orgId: actor.orgId, campaignId: c!.id, leadId: p.id })));
    }
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "campaign.create", entity: "campaigns", entityId: c!.id, after: { name, tags: input.tags, people: people.length, startAt: input.startAt ?? null, variants: openingVariants.length, mode: input.mode === "audio" ? "audio" : "ai" } });
    return { ...c!, people: people.length };
  });
}

/** List the organisation's reusable settings; the actual audience is rebuilt when a template is used. */
export async function listCampaignTemplates(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, (tx) => tx.select().from(campaignTemplates).orderBy(desc(campaignTemplates.createdAt)).limit(100));
}

/** Save or update a named campaign template for this organisation. */
export async function saveCampaignTemplate(db: Db, actor: AuthUser, input: CampaignTemplateInput) {
  assertAuthorized(actor, "calls.place");
  const name = input.name.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name || name.length > 120) throw new CampaignError("enter a template name of up to 120 characters");
  const tags = [...new Set(input.tags.map((t) => t.normalize("NFC").trim().toLowerCase()).filter(Boolean))];
  if (!tags.length || tags.length > 10 || tags.some((t) => t.length > 30)) throw new CampaignError("choose 1 to 10 tags, each up to 30 characters");
  const maxConcurrent = inRange(input.maxConcurrent, 1, 20, "calls at once");
  const maxAttempts = inRange(input.maxAttempts, 1, 5, "tries per person");
  const retryDelayMin = inRange(input.retryDelayMin, 5, 1440, "minutes between tries");
  const openingVariants = input.mode === "audio" ? [] : input.openingVariants.map((v) => v.normalize("NFC").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (openingVariants.length === 1) throw new CampaignError("an A/B test needs at least two opening lines (or leave them empty)");
  if (openingVariants.length > 3 || openingVariants.some((v) => v.length > 300)) throw new CampaignError("use up to 3 opening lines of up to 300 characters each");
  return withOrg(db, actor.orgId, async (tx) => {
    const [row] = await tx.insert(campaignTemplates).values({
      orgId: actor.orgId, name, language: input.language, tags, maxConcurrent, maxAttempts, retryDelayMin,
      detectMachines: input.detectMachines, mode: input.mode, openingVariants, createdBy: actor.id,
    }).onConflictDoUpdate({ target: [campaignTemplates.orgId, campaignTemplates.name], set: {
      language: input.language, tags, maxConcurrent, maxAttempts, retryDelayMin, detectMachines: input.detectMachines, mode: input.mode, openingVariants,
    } }).returning();
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "campaign_template.save", entity: "campaign_templates", entityId: row!.id, after: { name, mode: input.mode } });
    return row!;
  });
}

export async function deleteCampaignTemplate(db: Db, actor: AuthUser, templateId: string) {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, async (tx) => {
    const [row] = await tx.delete(campaignTemplates).where(eq(campaignTemplates.id, templateId)).returning({ id: campaignTemplates.id, name: campaignTemplates.name });
    if (!row) throw new CampaignError("campaign template not found");
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "campaign_template.delete", entity: "campaign_templates", entityId: row.id, after: { name: row.name } });
    return { id: row.id };
  });
}

export type CampaignCounts = Record<"pending" | "calling" | "done" | "failed" | "skipped", number>;
const zero = (): CampaignCounts => ({ pending: 0, calling: 0, done: 0, failed: 0, skipped: 0 });

export async function listCampaigns(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, async (tx) => {
    const rows = await tx.select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(100);
    const counts = rows.length
      ? await tx.select({ campaignId: campaignTargets.campaignId, status: campaignTargets.status, n: sql<number>`count(*)::int` }).from(campaignTargets)
          .where(inArray(campaignTargets.campaignId, rows.map((r) => r.id))).groupBy(campaignTargets.campaignId, campaignTargets.status)
      : [];
    const audioNames = new Map((await tx.select({ id: campaignAudio.campaignId, name: campaignAudio.name }).from(campaignAudio)).map((a) => [a.id, a.name]));
    const results = new Map<string, { variant: number; text: string; people: number; reached: number }[]>();
    for (const c of rows.filter((r) => r.openingVariants.length)) {
      const v = await tx.execute<{ variant: number; people: string; reached: string }>(sql`select * from campaign_variant_results(${c.id}::uuid)`);
      results.set(c.id, v.rows.map((r) => ({ variant: r.variant, text: c.openingVariants[r.variant - 1] ?? "", people: Number(r.people), reached: Number(r.reached) })));
    }
    return rows.map((c) => {
      const k = zero();
      for (const x of counts) if (x.campaignId === c.id) k[x.status] = x.n;
      return { ...c, counts: k, total: Object.values(k).reduce((a, b) => a + b, 0), variants: results.get(c.id) ?? [], audioName: audioNames.get(c.id) ?? null };
    });
  });
}

/** One campaign with its people, so the live queue can be watched. Numbers are masked for roles without lead PII access. */
export async function getCampaign(db: Db, actor: AuthUser, campaignId: string) {
  assertAuthorized(actor, "calls.place");
  const showPhone = actor.permissions.includes("leads.pii.read");
  return withOrg(db, actor.orgId, async (tx) => {
    const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!c) return null;
    const people = await tx.select({ id: campaignTargets.id, status: campaignTargets.status, attempts: campaignTargets.attempts, nextAttemptAt: campaignTargets.nextAttemptAt, lastError: campaignTargets.lastError, name: leads.name, phone: leads.phoneE164 })
      .from(campaignTargets).innerJoin(leads, eq(leads.id, campaignTargets.leadId)).where(eq(campaignTargets.campaignId, campaignId)).orderBy(campaignTargets.createdAt).limit(500);
    const counts = zero();
    for (const r of await tx.select({ status: campaignTargets.status, n: sql<number>`count(*)::int` }).from(campaignTargets).where(eq(campaignTargets.campaignId, campaignId)).groupBy(campaignTargets.status)) counts[r.status] = r.n;
    const variants = c.openingVariants.length
      ? (await tx.execute<{ variant: number; people: string; reached: string }>(sql`select * from campaign_variant_results(${campaignId}::uuid)`)).rows
          .map((r) => ({ variant: r.variant, text: c.openingVariants[r.variant - 1] ?? "", people: Number(r.people), reached: Number(r.reached) }))
      : [];
    return { ...c, counts, variants, people: people.map((p) => ({ ...p, phone: showPhone ? p.phone : maskPhone(p.phone) })) };
  });
}

export type CampaignAction = "start" | "pause" | "resume" | "cancel";
const FROM: Record<CampaignAction, readonly (typeof CAMPAIGN_STATUSES)[number][]> = { start: ["draft", "scheduled"], pause: ["running"], resume: ["paused"], cancel: ["draft", "scheduled", "running", "paused"] };

/** start / pause / resume / cancel. Cancelling closes everyone still waiting. A call already ringing is not cut off. */
export async function updateCampaignStatus(db: Db, actor: AuthUser, campaignId: string, action: CampaignAction) {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, async (tx) => {
    const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!c) throw new CampaignError("campaign not found");
    if (!FROM[action].includes(c.status)) throw new CampaignError(`a ${c.status} campaign cannot be ${action === "start" ? "started" : action === "pause" ? "paused" : action === "resume" ? "resumed" : "cancelled"}`);
    if (action === "start" || action === "resume") {
      await assertKyc(tx, actor.orgId);
      if (c.mode === "audio" && !(await tx.select({ id: campaignAudio.campaignId }).from(campaignAudio).where(eq(campaignAudio.campaignId, campaignId))).length) throw new CampaignError("upload the recording first: this campaign plays a recording and has none yet");
    }
    const status = action === "pause" ? "paused" : action === "cancel" ? "cancelled" : "running";
    await tx.update(campaigns).set({ status, ...(status === "running" ? { startedAt: c.startedAt ?? new Date() } : {}), ...(status === "cancelled" ? { finishedAt: new Date() } : {}) }).where(eq(campaigns.id, campaignId));
    if (status === "cancelled") await tx.update(campaignTargets).set({ status: "skipped", lastError: "campaign cancelled" }).where(and(eq(campaignTargets.campaignId, campaignId), eq(campaignTargets.status, "pending")));
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: `campaign.${action}`, entity: "campaigns", entityId: campaignId, before: { status: c.status }, after: { status } });
    return { id: campaignId, status };
  });
}

// ------------------------------------------------------------------------------------------ the runner (worker)

export interface DialJob { targetId: string; campaignId: string; orgId: string; leadId: string; language: string; voice: string | null; createdBy: string; detectMachines: boolean; opening: string | null; mode: "ai" | "audio" }

/** One round for the campaign runner: settles finished calls, starts due campaigns, and returns the people to dial now. Run by ONE worker. */
export async function campaignTick(db: Db, limit = 10): Promise<DialJob[]> {
  const r = await db.execute<{ target_id: string; campaign_id: string; org_id: string; lead_id: string; language: string; voice: string | null; created_by: string; detect_machines: boolean; opening: string | null; mode: "ai" | "audio" }>(sql`select * from worker_campaign_tick(${limit})`);
  return r.rows.map((x) => ({ targetId: x.target_id, campaignId: x.campaign_id, orgId: x.org_id, leadId: x.lead_id, language: x.language, voice: x.voice, createdBy: x.created_by, detectMachines: x.detect_machines, opening: x.opening, mode: x.mode }));
}

export async function reportDial(db: Db, targetId: string, outcome: "failed" | "hours" | "skip", error?: string) {
  await db.execute(sql`select worker_campaign_dial_result(${targetId}::uuid, ${outcome}, ${error ?? null})`);
}

/** The signed pass the voice service wants before it dials: it carries the campaign creator's identity, so their permissions and the calling rules apply. */
export const dialToken = (job: DialJob, key: string) => signVoiceToken({ sub: job.createdBy, org: job.orgId, voice: job.voice ?? undefined }, key, 120);

/** The phone line heard an answering machine: the campaign's try for this person counts as failed and is repeated later. */
export async function reportMachine(db: Db, leadId: string) {
  await db.execute(sql`select worker_campaign_machine(${leadId}::uuid)`);
}

// ------------------------------------------------------------------------------------------ audio campaigns

export const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

/** What the bytes really are (the file's own header, never the name or the label the browser gave it): "audio/wav", "audio/mpeg", or null. */
export function sniffAudio(b: Uint8Array): "audio/wav" | "audio/mpeg" | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (b.length >= 3 && ascii(0, 3) === "ID3") return "audio/mpeg";
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return "audio/mpeg";
  return null;
}

/** Stores (or replaces) the recording of an audio campaign that has not started. */
export async function saveCampaignAudio(db: Db, actor: AuthUser, campaignId: string, input: { name: string; data: Uint8Array }) {
  assertAuthorized(actor, "calls.place");
  if (input.data.length < 1000) throw new CampaignError("that file is too small to be a recording");
  if (input.data.length > MAX_AUDIO_BYTES) throw new CampaignError("the recording must be 5 MB or smaller");
  const mime = sniffAudio(input.data);
  if (!mime) throw new CampaignError("the file must be an MP3 or a WAV recording");
  const name = input.name.normalize("NFC").replace(/[\u0000-\u001f<>"\\/]/g, "").trim().slice(0, 120) || "recording";
  return withOrg(db, actor.orgId, async (tx) => {
    const [c] = await tx.select({ mode: campaigns.mode, status: campaigns.status }).from(campaigns).where(eq(campaigns.id, campaignId));
    if (!c) throw new CampaignError("campaign not found");
    if (c.mode !== "audio") throw new CampaignError("this campaign is an AI conversation: it has no recording");
    if (!["draft", "scheduled", "paused"].includes(c.status)) throw new CampaignError("the recording can only be changed before the campaign starts or while it is paused");
    await tx.insert(campaignAudio).values({ campaignId, orgId: actor.orgId, name, mime, data: Buffer.from(input.data) }).onConflictDoUpdate({ target: campaignAudio.campaignId, set: { name, mime, data: Buffer.from(input.data), createdAt: new Date() } });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "campaign.audio", entity: "campaigns", entityId: campaignId, after: { name, mime, bytes: input.data.length } });
    return { name, mime, bytes: input.data.length };
  });
}

/** For the voice service when a person answers: the recording, for this organisation's campaign. */
export async function getCampaignAudio(db: Db, orgId: string, campaignId: string): Promise<{ mime: "audio/wav" | "audio/mpeg"; data: Buffer } | null> {
  return withOrg(db, orgId, async (tx) => {
    const [a] = await tx.select({ mime: campaignAudio.mime, data: campaignAudio.data }).from(campaignAudio).where(eq(campaignAudio.campaignId, campaignId));
    return a ?? null;
  });
}
