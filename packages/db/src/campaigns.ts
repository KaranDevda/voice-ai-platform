import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { assertAuthorized, signVoiceToken, type AuthUser } from "@voiceai/auth";
import { maskPhone } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { assertKyc } from "./platform-admin";
import { withOrg, type Db } from "./client";
import { scopeCondition } from "./scoped";
import { callTimingStats, nextBestHourAt } from "./scheduling";
import { textArray } from "./sql-array";
import { agentProfiles, campaignAudio, campaignTemplates, campaigns, campaignTargets, callLogs, leads, phoneNumbers, type CAMPAIGN_STATUSES } from "./schema";

export class CampaignError extends Error {}

export interface CampaignInput {
  name: string; language: "en" | "hi" | "en-hi"; voice?: string | null; callerId?: string | null; aiModel?: "inherit" | "default" | "openrouter"; openrouterModel?: string; agentProfileId?: string | null;
  /** Everyone with ANY of these tags is called. */
  tags: string[];
  startAt?: Date | null; autoSchedule?: boolean; maxConcurrent: number; maxAttempts: number; retryDelayMin: number;
  /** Hang up on answering machines (default on). */
  detectMachines?: boolean;
  /** "audio": play a recording (upload it after creating) instead of an AI conversation. */
  mode?: "ai" | "audio";
  /** A/B test: up to 3 opening lines, each person hears one. */
  openingVariants?: string[];
}

export interface CampaignTemplateInput {
  name: string; language: "en" | "hi" | "en-hi"; tags: string[]; callerId?: string | null; aiModel?: "inherit" | "default" | "openrouter"; openrouterModel?: string; agentProfileId?: string | null; autoSchedule?: boolean; maxConcurrent: number; maxAttempts: number;
  retryDelayMin: number; detectMachines: boolean; mode: "ai" | "audio"; openingVariants: string[];
}

const inRange = (v: number, lo: number, hi: number, what: string) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new CampaignError(`${what} must be a whole number from ${lo} to ${hi}`);
  return v;
};

function validateCampaignModel(model: CampaignInput["aiModel"], openrouterModel: string | undefined) {
  if (model === "openrouter" && (!openrouterModel || openrouterModel.length > 100 || !/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i.test(openrouterModel))) {
    throw new CampaignError("enter a valid OpenRouter model ID, such as openai/gpt-4o-mini");
  }
}

async function validateAgentProfile(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], profileId: string | null | undefined) {
  if (!profileId) return null;
  const [profile] = await tx.select({ id: agentProfiles.id }).from(agentProfiles).where(eq(agentProfiles.id, profileId));
  if (!profile) throw new CampaignError("choose an agent profile from your organisation");
  return profile.id;
}

/**
 * Makes a campaign from everyone (the person may see) who has one of the tags and is not on Do Not Disturb or without consent.
 * With a start time it waits for it ("scheduled"); without, it waits for Start ("draft"). Nobody is called until it runs.
 */
export async function createCampaign(db: Db, actor: AuthUser, input: CampaignInput) {
  assertAuthorized(actor, "calls.place");
  const name = input.name.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name || name.length > 120) throw new CampaignError("enter a name of up to 120 characters");
  if (input.tags.length === 0) throw new CampaignError("choose at least one tag: the campaign calls everyone with it");
  validateCampaignModel(input.aiModel, input.openrouterModel);
  const maxConcurrent = inRange(input.maxConcurrent, 1, 20, "calls at once");
  const maxAttempts = inRange(input.maxAttempts, 1, 5, "tries per person");
  const retryDelayMin = inRange(input.retryDelayMin, 5, 1440, "minutes between tries");
  const openingVariants = (input.openingVariants ?? []).map((v) => v.normalize("NFC").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (openingVariants.length === 1) throw new CampaignError("an A/B test needs at least two opening lines (or leave them empty)");
  if (openingVariants.length > 3 || openingVariants.some((v) => v.length > 300)) throw new CampaignError("use up to 3 opening lines of up to 300 characters each");
  if (input.autoSchedule && input.startAt) throw new CampaignError("choose either an exact start time or automatic best-time scheduling");
  let startAt = input.startAt ?? null;
  if (input.autoSchedule) {
    const stats = await callTimingStats(db, actor);
    const best = stats.best[0];
    if (!best) throw new CampaignError(`automatic scheduling needs at least ${stats.minAttempts} previous outbound calls in one calling hour`);
    startAt = nextBestHourAt(best.hourIst);
  }
  if (startAt && startAt.getTime() < Date.now() - 60_000) throw new CampaignError("the start time is in the past");
  return withOrg(db, actor.orgId, async (tx) => {
    const callerId = await validateCallerId(tx, actor.orgId, input.callerId);
    const agentProfileId = input.mode === "audio" ? null : await validateAgentProfile(tx, input.agentProfileId);
    const visible = scopeCondition(actor, "leads.read", { orgId: leads.orgId, teamId: leads.teamId, ownerUserId: leads.ownerUserId });
    const people = await tx.select({ id: leads.id }).from(leads)
      .where(and(visible, eq(leads.dndFlag, false), sql`${leads.consentStatus} not in ('denied','withdrawn')`, sql`${leads.tags} && ${textArray(input.tags)}`))
      .limit(5001);
    if (people.length === 0) throw new CampaignError("nobody with those tags can be called (check the tags, Do Not Disturb and consent)");
    if (people.length > 5000) throw new CampaignError("a campaign can have at most 5000 people; use a narrower tag");
    const [c] = await tx.insert(campaigns).values({
      orgId: actor.orgId, name, language: input.language, voice: input.voice || null, callerId, aiModel: input.aiModel && input.aiModel !== "inherit" ? input.aiModel : null, openrouterModel: input.aiModel === "openrouter" ? input.openrouterModel ?? "openai/gpt-4o-mini" : null, startAt,
      agentProfileId,
      status: startAt ? "scheduled" : "draft", maxConcurrent, maxAttempts, retryDelayMin, createdBy: actor.id,
      detectMachines: input.detectMachines ?? true, openingVariants: input.mode === "audio" ? [] : openingVariants, mode: input.mode === "audio" ? "audio" : "ai",
    }).returning();
    for (let i = 0; i < people.length; i += 500) {
      await tx.insert(campaignTargets).values(people.slice(i, i + 500).map((p) => ({ orgId: actor.orgId, campaignId: c!.id, leadId: p.id })));
    }
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "campaign.create", entity: "campaigns", entityId: c!.id, after: { name, tags: input.tags, people: people.length, startAt, autoSchedule: input.autoSchedule ?? false, variants: openingVariants.length, mode: input.mode === "audio" ? "audio" : "ai", callerId } });
    return { ...c!, people: people.length };
  });
}

/** List the organisation's reusable settings; the actual audience is rebuilt when a template is used. */
export async function listCampaignTemplates(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, (tx) => tx.select().from(campaignTemplates).orderBy(desc(campaignTemplates.createdAt)).limit(100));
}

export async function listAgentProfiles(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, (tx) => tx.select({
    id: agentProfiles.id, name: agentProfiles.name, instructions: agentProfiles.instructions, knowledgeText: agentProfiles.knowledgeText,
  }).from(agentProfiles).orderBy(agentProfiles.name).limit(100));
}

type AgentProfileInput = { name: string; instructions: string; knowledgeText: string };

function normalizeAgentProfileInput(input: AgentProfileInput): AgentProfileInput {
  const name = input.name.normalize("NFC").replace(/\s+/g, " ").trim();
  const instructions = input.instructions.normalize("NFC").trim();
  const knowledgeText = input.knowledgeText.normalize("NFC").trim();
  if (!name || name.length > 80) throw new CampaignError("enter an agent name of up to 80 characters");
  if (!instructions || instructions.length > 6000) throw new CampaignError("instructions must be 1 to 6000 characters");
  if (!knowledgeText || knowledgeText.length > 12000) throw new CampaignError("knowledge must be 1 to 12000 characters");
  return { name, instructions, knowledgeText };
}

export async function createAgentProfile(db: Db, actor: AuthUser, input: AgentProfileInput) {
  assertAuthorized(actor, "calls.place");
  const { name, instructions, knowledgeText } = normalizeAgentProfileInput(input);
  return withOrg(db, actor.orgId, async (tx) => {
    const [row] = await tx.insert(agentProfiles).values({ orgId: actor.orgId, name, instructions, knowledgeText, createdBy: actor.id }).returning({ id: agentProfiles.id, name: agentProfiles.name });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "agent_profile.create", entity: "agent_profiles", entityId: row!.id, after: { name } });
    return row!;
  });
}

export async function updateAgentProfile(db: Db, actor: AuthUser, profileId: string, input: AgentProfileInput) {
  assertAuthorized(actor, "calls.place");
  const { name, instructions, knowledgeText } = normalizeAgentProfileInput(input);
  return withOrg(db, actor.orgId, async (tx) => {
    const [before] = await tx.select({
      id: agentProfiles.id, name: agentProfiles.name, instructions: agentProfiles.instructions, knowledgeText: agentProfiles.knowledgeText,
    }).from(agentProfiles).where(and(eq(agentProfiles.id, profileId), eq(agentProfiles.orgId, actor.orgId))).limit(1);
    if (!before) throw new CampaignError("agent profile not found");

    const [duplicate] = await tx.select({ id: agentProfiles.id }).from(agentProfiles)
      .where(and(eq(agentProfiles.orgId, actor.orgId), eq(agentProfiles.name, name), ne(agentProfiles.id, profileId))).limit(1);
    if (duplicate) throw new CampaignError("an agent profile with this name already exists");

    const [updated] = await tx.update(agentProfiles).set({ name, instructions, knowledgeText })
      .where(and(eq(agentProfiles.id, profileId), eq(agentProfiles.orgId, actor.orgId)))
      .returning({ id: agentProfiles.id, name: agentProfiles.name, instructions: agentProfiles.instructions, knowledgeText: agentProfiles.knowledgeText });
    if (!updated) throw new CampaignError("agent profile not found");
    await writeAudit(tx, {
      orgId: actor.orgId, actorUserId: actor.id, action: "agent_profile.update", entity: "agent_profiles", entityId: updated.id,
      before: { name: before.name, instructionsLength: before.instructions.length, knowledgeLength: before.knowledgeText.length },
      after: { name, instructionsLength: instructions.length, knowledgeLength: knowledgeText.length },
    });
    return updated;
  });
}

export async function deleteAgentProfile(db: Db, actor: AuthUser, profileId: string) {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, async (tx) => {
    const [campaign] = await tx.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.agentProfileId, profileId)).limit(1);
    const [template] = await tx.select({ id: campaignTemplates.id }).from(campaignTemplates).where(eq(campaignTemplates.agentProfileId, profileId)).limit(1);
    if (campaign || template) throw new CampaignError("this agent is used by a campaign or template; remove those references first");
    const [row] = await tx.delete(agentProfiles).where(eq(agentProfiles.id, profileId)).returning({ id: agentProfiles.id, name: agentProfiles.name });
    if (!row) throw new CampaignError("agent profile not found");
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "agent_profile.delete", entity: "agent_profiles", entityId: row.id, before: { name: row.name } });
    return { id: row.id };
  });
}

/** Loads a profile only for a worker-issued, signed campaign token. */
export async function getCampaignAgentProfile(db: Db, orgId: string, profileId: string) {
  return withOrg(db, orgId, async (tx) => {
    const [profile] = await tx.select({ id: agentProfiles.id, name: agentProfiles.name, instructions: agentProfiles.instructions, knowledgeText: agentProfiles.knowledgeText })
      .from(agentProfiles).where(eq(agentProfiles.id, profileId));
    return profile ?? null;
  });
}

/** Organisation-owned Plivo numbers available as outbound campaign caller IDs. */
export async function listCampaignCallerIds(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "calls.place");
  return withOrg(db, actor.orgId, async (tx) => {
    const rows = await tx.select({ e164: phoneNumbers.e164, capabilities: phoneNumbers.capabilities })
      .from(phoneNumbers).where(and(eq(phoneNumbers.orgId, actor.orgId), eq(phoneNumbers.status, "assigned")))
      .orderBy(phoneNumbers.e164);
    return rows.filter((r) => r.capabilities.includes("voice")).map((r) => r.e164);
  });
}

/** Recheck number ownership at dial time, since an assigned number can later be released. */
export async function isCampaignCallerId(db: Db, orgId: string, e164: string) {
  return withOrg(db, orgId, async (tx) => {
    const [row] = await tx.select({ capabilities: phoneNumbers.capabilities }).from(phoneNumbers)
      .where(and(eq(phoneNumbers.orgId, orgId), eq(phoneNumbers.e164, e164), eq(phoneNumbers.status, "assigned")));
    return row?.capabilities.includes("voice") ?? false;
  });
}

async function validateCallerId(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], orgId: string, value: string | null | undefined) {
  const callerId = value?.trim() || null;
  if (!callerId) return null;
  const [row] = await tx.select({ capabilities: phoneNumbers.capabilities }).from(phoneNumbers)
    .where(and(eq(phoneNumbers.orgId, orgId), eq(phoneNumbers.e164, callerId), eq(phoneNumbers.status, "assigned")));
  if (!row || !row.capabilities.includes("voice")) throw new CampaignError("choose a voice-enabled number assigned to your organisation");
  return callerId;
}

/** Save or update a named campaign template for this organisation. */
export async function saveCampaignTemplate(db: Db, actor: AuthUser, input: CampaignTemplateInput) {
  assertAuthorized(actor, "calls.place");
  const name = input.name.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name || name.length > 120) throw new CampaignError("enter a template name of up to 120 characters");
  const tags = [...new Set(input.tags.map((t) => t.normalize("NFC").trim().toLowerCase()).filter(Boolean))];
  if (!tags.length || tags.length > 10 || tags.some((t) => t.length > 30)) throw new CampaignError("choose 1 to 10 tags, each up to 30 characters");
  validateCampaignModel(input.aiModel, input.openrouterModel);
  const maxConcurrent = inRange(input.maxConcurrent, 1, 20, "calls at once");
  const maxAttempts = inRange(input.maxAttempts, 1, 5, "tries per person");
  const retryDelayMin = inRange(input.retryDelayMin, 5, 1440, "minutes between tries");
  const openingVariants = input.mode === "audio" ? [] : input.openingVariants.map((v) => v.normalize("NFC").replace(/\s+/g, " ").trim()).filter(Boolean);
  if (openingVariants.length === 1) throw new CampaignError("an A/B test needs at least two opening lines (or leave them empty)");
  if (openingVariants.length > 3 || openingVariants.some((v) => v.length > 300)) throw new CampaignError("use up to 3 opening lines of up to 300 characters each");
  return withOrg(db, actor.orgId, async (tx) => {
    const callerId = await validateCallerId(tx, actor.orgId, input.callerId);
    const agentProfileId = input.mode === "audio" ? null : await validateAgentProfile(tx, input.agentProfileId);
    const [row] = await tx.insert(campaignTemplates).values({
      orgId: actor.orgId, name, language: input.language, tags, callerId, aiModel: input.aiModel && input.aiModel !== "inherit" ? input.aiModel : null, openrouterModel: input.aiModel === "openrouter" ? input.openrouterModel ?? "openai/gpt-4o-mini" : null, autoSchedule: input.autoSchedule ?? false, maxConcurrent, maxAttempts, retryDelayMin,
      agentProfileId,
      detectMachines: input.detectMachines, mode: input.mode, openingVariants, createdBy: actor.id,
    }).onConflictDoUpdate({ target: [campaignTemplates.orgId, campaignTemplates.name], set: {
      language: input.language, tags, callerId, aiModel: input.aiModel && input.aiModel !== "inherit" ? input.aiModel : null, openrouterModel: input.aiModel === "openrouter" ? input.openrouterModel ?? "openai/gpt-4o-mini" : null, agentProfileId, autoSchedule: input.autoSchedule ?? false, maxConcurrent, maxAttempts, retryDelayMin, detectMachines: input.detectMachines, mode: input.mode, openingVariants,
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
    const ids = rows.map((r) => r.id);
    const counts = rows.length
      ? await tx.select({ campaignId: campaignTargets.campaignId, status: campaignTargets.status, n: sql<number>`count(*)::int` }).from(campaignTargets)
          .where(inArray(campaignTargets.campaignId, ids)).groupBy(campaignTargets.campaignId, campaignTargets.status)
      : [];
    const connected = rows.length
      ? await tx.select({ campaignId: campaignTargets.campaignId, n: sql<number>`count(*)::int` })
          .from(campaignTargets).innerJoin(callLogs, eq(callLogs.leadId, campaignTargets.leadId))
          .where(and(inArray(campaignTargets.campaignId, ids), eq(callLogs.status, "connected"), eq(callLogs.orgId, actor.orgId)))
          .groupBy(campaignTargets.campaignId)
      : [];
    const audioNames = new Map((await tx.select({ id: campaignAudio.campaignId, name: campaignAudio.name }).from(campaignAudio)).map((a) => [a.id, a.name]));
    const results = new Map<string, { variant: number; text: string; people: number; reached: number }[]>();
    for (const c of rows.filter((r) => r.openingVariants.length)) {
      const v = await tx.execute<{ variant: number; people: string; reached: string }>(sql`select * from campaign_variant_results(${c.id}::uuid)`);
      results.set(c.id, v.rows.map((r) => ({ variant: r.variant, text: c.openingVariants[r.variant - 1] ?? "", people: Number(r.people), reached: Number(r.reached) })));
    }
    const connectedByCampaign = new Map(connected.map((c) => [c.campaignId, Number(c.n)]));
    return rows.map((c) => {
      const k = zero();
      for (const x of counts) if (x.campaignId === c.id) k[x.status] = x.n;
      return { ...c, counts: k, total: Object.values(k).reduce((a, b) => a + b, 0), connected: connectedByCampaign.get(c.id) ?? 0, variants: results.get(c.id) ?? [], audioName: audioNames.get(c.id) ?? null };
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

export interface DialJob { targetId: string; campaignId: string; orgId: string; leadId: string; language: string; voice: string | null; callerId: string | null; createdBy: string; detectMachines: boolean; opening: string | null; mode: "ai" | "audio"; aiModel: "default" | "openrouter" | null; openrouterModel: string | null; agentProfileId: string | null }

/** One round for the campaign runner: settles finished calls, starts due campaigns, and returns the people to dial now. Run by ONE worker. */
export async function campaignTick(db: Db, limit = 10): Promise<DialJob[]> {
  const r = await db.execute<{ target_id: string; campaign_id: string; org_id: string; lead_id: string; language: string; voice: string | null; created_by: string; detect_machines: boolean; opening: string | null; mode: "ai" | "audio"; caller_id: string | null; ai_model: "default" | "openrouter" | null; openrouter_model: string | null; agent_profile_id: string | null }>(sql`select * from worker_campaign_tick(${limit})`);
  return r.rows.map((x) => ({ targetId: x.target_id, campaignId: x.campaign_id, orgId: x.org_id, leadId: x.lead_id, language: x.language, voice: x.voice, callerId: x.caller_id, createdBy: x.created_by, detectMachines: x.detect_machines, opening: x.opening, mode: x.mode, aiModel: x.ai_model, openrouterModel: x.openrouter_model, agentProfileId: x.agent_profile_id }));
}

export async function reportDial(db: Db, targetId: string, outcome: "failed" | "hours" | "skip", error?: string) {
  await db.execute(sql`select worker_campaign_dial_result(${targetId}::uuid, ${outcome}, ${error ?? null})`);
}

/** The signed pass the voice service wants before it dials: it carries the campaign creator's identity, so their permissions and the calling rules apply. */
export const dialToken = (job: DialJob, key: string) => signVoiceToken({ sub: job.createdBy, org: job.orgId, voice: job.voice ?? undefined, aiModel: job.aiModel ?? undefined, openrouterModel: job.openrouterModel ?? undefined, agentProfileId: job.agentProfileId ?? undefined }, key, 120);

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
