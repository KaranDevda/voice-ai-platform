import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { assertAuthorized, signVoiceToken, type AuthUser } from "@voiceai/auth";
import { maskPhone } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { assertKyc } from "./platform-admin";
import { withOrg, type Db } from "./client";
import { scopeCondition } from "./scoped";
import { campaigns, campaignTargets, leads, type CAMPAIGN_STATUSES } from "./schema";

export class CampaignError extends Error {}

export interface CampaignInput {
  name: string; language: "en" | "hi" | "en-hi"; voice?: string | null;
  /** Everyone with ANY of these tags is called. */
  tags: string[];
  startAt?: Date | null; maxConcurrent: number; maxAttempts: number; retryDelayMin: number;
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
  if (input.startAt && input.startAt.getTime() < Date.now() - 60_000) throw new CampaignError("the start time is in the past");
  return withOrg(db, actor.orgId, async (tx) => {
    const visible = scopeCondition(actor, "leads.read", { orgId: leads.orgId, teamId: leads.teamId, ownerUserId: leads.ownerUserId });
    const people = await tx.select({ id: leads.id }).from(leads)
      .where(and(visible, eq(leads.dndFlag, false), sql`${leads.consentStatus} not in ('denied','withdrawn')`, sql`${leads.tags} && ${input.tags}::text[]`))
      .limit(5001);
    if (people.length === 0) throw new CampaignError("nobody with those tags can be called (check the tags, Do Not Disturb and consent)");
    if (people.length > 5000) throw new CampaignError("a campaign can have at most 5000 people; use a narrower tag");
    const [c] = await tx.insert(campaigns).values({
      orgId: actor.orgId, name, language: input.language, voice: input.voice || null, startAt: input.startAt ?? null,
      status: input.startAt ? "scheduled" : "draft", maxConcurrent, maxAttempts, retryDelayMin, createdBy: actor.id,
    }).returning();
    for (let i = 0; i < people.length; i += 500) {
      await tx.insert(campaignTargets).values(people.slice(i, i + 500).map((p) => ({ orgId: actor.orgId, campaignId: c!.id, leadId: p.id })));
    }
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "campaign.create", entity: "campaigns", entityId: c!.id, after: { name, tags: input.tags, people: people.length, startAt: input.startAt ?? null } });
    return { ...c!, people: people.length };
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
    return rows.map((c) => {
      const k = zero();
      for (const x of counts) if (x.campaignId === c.id) k[x.status] = x.n;
      return { ...c, counts: k, total: Object.values(k).reduce((a, b) => a + b, 0) };
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
    return { ...c, counts, people: people.map((p) => ({ ...p, phone: showPhone ? p.phone : maskPhone(p.phone) })) };
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
    if (action === "start" || action === "resume") await assertKyc(tx, actor.orgId);
    const status = action === "pause" ? "paused" : action === "cancel" ? "cancelled" : "running";
    await tx.update(campaigns).set({ status, ...(status === "running" ? { startedAt: c.startedAt ?? new Date() } : {}), ...(status === "cancelled" ? { finishedAt: new Date() } : {}) }).where(eq(campaigns.id, campaignId));
    if (status === "cancelled") await tx.update(campaignTargets).set({ status: "skipped", lastError: "campaign cancelled" }).where(and(eq(campaignTargets.campaignId, campaignId), eq(campaignTargets.status, "pending")));
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: `campaign.${action}`, entity: "campaigns", entityId: campaignId, before: { status: c.status }, after: { status } });
    return { id: campaignId, status };
  });
}

// ------------------------------------------------------------------------------------------ the runner (worker)

export interface DialJob { targetId: string; campaignId: string; orgId: string; leadId: string; language: string; voice: string | null; createdBy: string }

/** One round for the campaign runner: settles finished calls, starts due campaigns, and returns the people to dial now. Run by ONE worker. */
export async function campaignTick(db: Db, limit = 10): Promise<DialJob[]> {
  const r = await db.execute<{ target_id: string; campaign_id: string; org_id: string; lead_id: string; language: string; voice: string | null; created_by: string }>(sql`select * from worker_campaign_tick(${limit})`);
  return r.rows.map((x) => ({ targetId: x.target_id, campaignId: x.campaign_id, orgId: x.org_id, leadId: x.lead_id, language: x.language, voice: x.voice, createdBy: x.created_by }));
}

export async function reportDial(db: Db, targetId: string, outcome: "failed" | "hours" | "skip", error?: string) {
  await db.execute(sql`select worker_campaign_dial_result(${targetId}::uuid, ${outcome}, ${error ?? null})`);
}

/** The signed pass the voice service wants before it dials: it carries the campaign creator's identity, so their permissions and the calling rules apply. */
export const dialToken = (job: DialJob, key: string) => signVoiceToken({ sub: job.createdBy, org: job.orgId, voice: job.voice ?? undefined }, key, 120);
