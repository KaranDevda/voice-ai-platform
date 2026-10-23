import { aliasedTable, and, desc, eq, gte, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { assertAuthorized, authorize, ForbiddenError, resolveScope, type AuthUser, type ScopedBase } from "@voiceai/auth";
import { orgSettingsSchema, orgSettingsUpdateSchema, type LeadStatus } from "@voiceai/shared";
import { maskPhone } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { scopeCondition } from "./scoped";
import {
  auditLogs, callInsights, callLogs, callTranscripts, consentRecords, devices, kbChunks, kbDocuments,
  leads, leadStatusHistory, organizations, roles, userRoles, users, voiceProfiles,
} from "./schema";

export const PAGE_SIZE = 15;
const num = (e: SQL) => e.mapWith(Number);
const canSeePii = (u: AuthUser) => u.permissions.includes("leads.pii.read");
const phone = (u: AuthUser, p: string) => (canSeePii(u) ? p : maskPhone(p));
const day = (n: number) => new Date(Date.now() - n * 86_400_000);

const callCols = { orgId: callLogs.orgId, teamId: callLogs.teamId, ownerUserId: callLogs.agentUserId };
const leadCols = { orgId: leads.orgId, teamId: leads.teamId, ownerUserId: leads.ownerUserId };

/** Aggregate-only roles (Viewer) may count org-wide but never see individual records. */
function aggregateScope(user: AuthUser, base: ScopedBase): { where: SQL; aggregateOnly: boolean } {
  const scope = resolveScope(user, base);
  if (!scope) throw new ForbiddenError(base, "missing_permission");
  if (scope === "aggregate") return { where: eq(callLogs.orgId, user.orgId), aggregateOnly: true };
  return { where: scopeCondition(user, base, callCols), aggregateOnly: false };
}

// ---------------------------------------------------------------- dashboard

export async function dashboardStats(db: Db, user: AuthUser, days = 7) {
  const { where, aggregateOnly } = aggregateScope(user, "calls.read");
  const since = day(days - 1);
  since.setHours(0, 0, 0, 0);
  const inRange = and(where, gte(callLogs.startedAt, since))!;

  return withOrg(db, user.orgId, async (tx) => {
    const [t] = await tx
      .select({
        total: num(sql`count(*)`),
        connected: num(sql`count(*) filter (where ${callLogs.status} = 'connected')`),
        missed: num(sql`count(*) filter (where ${callLogs.status} = 'missed')`),
        ai: num(sql`count(*) filter (where ${callLogs.source} in ('ai_inbound','ai_outbound'))`),
        handoffs: num(sql`count(*) filter (where ${callLogs.handoffToUserId} is not null)`),
        talkSeconds: num(sql`coalesce(sum(${callLogs.durationS}) filter (where ${callLogs.status} = 'connected'), 0)`),
      })
      .from(callLogs)
      .where(inRange);

    const [s] = await tx
      .select({ avg: sql<number | null>`avg(${callInsights.sentimentScore})`.mapWith((v) => (v === null ? null : Number(v))) })
      .from(callInsights)
      .innerJoin(callLogs, eq(callLogs.id, callInsights.callLogId))
      .where(inRange);

    const perDay = await tx
      .select({
        d: sql<string>`to_char(${callLogs.startedAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`,
        ai: num(sql`count(*) filter (where ${callLogs.source} in ('ai_inbound','ai_outbound'))`),
        web: num(sql`count(*) filter (where ${callLogs.source} = 'web_dialer')`),
        mobile: num(sql`count(*) filter (where ${callLogs.source} = 'mobile_sim')`),
      })
      .from(callLogs)
      .where(inRange)
      .groupBy(sql`1`);

    const byKey = new Map(perDay.map((r) => [r.d, r]));
    const series = Array.from({ length: days }, (_, i) => {
      const dt = day(days - 1 - i);
      const key = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(dt);
      const r = byKey.get(key);
      return { label: new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(dt), ai: r?.ai ?? 0, web: r?.web ?? 0, mobile: r?.mobile ?? 0 };
    });

    let leadsByStatus: Array<{ status: LeadStatus; n: number }> | null = null;
    if (resolveScope(user, "leads.read") && resolveScope(user, "leads.read") !== "aggregate") {
      leadsByStatus = await tx
        .select({ status: leads.status, n: num(sql`count(*)`) })
        .from(leads)
        .where(scopeCondition(user, "leads.read", leadCols))
        .groupBy(leads.status);
    }

    return { aggregateOnly, days, totals: { ...t!, avgSentiment: s?.avg ?? null }, series, leadsByStatus };
  });
}

// -------------------------------------------------------------------- calls

export interface CallFilters { q?: string; source?: string; status?: string; page?: number; leadId?: string }

export async function listCalls(db: Db, user: AuthUser, f: CallFilters = {}, pageSize = PAGE_SIZE) {
  const { where, aggregateOnly } = aggregateScope(user, "calls.read");
  if (aggregateOnly) throw new ForbiddenError("calls.read", "aggregate_only");
  const page = Math.max(1, f.page ?? 1);
  const agent = aliasedTable(users, "agent");

  const conds: SQL[] = [where];
  if (f.source) conds.push(eq(callLogs.source, f.source as never));
  if (f.status) conds.push(eq(callLogs.status, f.status as never));
  if (f.leadId) conds.push(eq(callLogs.leadId, f.leadId));
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    conds.push(or(ilike(leads.name, like), ilike(leads.phoneE164, like))!);
  }

  const rows = await withOrg(db, user.orgId, (tx) =>
    tx
      .select({
        id: callLogs.id, startedAt: callLogs.startedAt, direction: callLogs.direction, source: callLogs.source,
        status: callLogs.status, durationS: callLogs.durationS, hasRecording: sql<boolean>`${callLogs.recordingKey} is not null`,
        leadId: callLogs.leadId, leadName: leads.name, leadPhone: leads.phoneE164, agentEmail: agent.email,
        sentimentLabel: callInsights.sentimentLabel, handedOff: sql<boolean>`${callLogs.handoffToUserId} is not null`,
      })
      .from(callLogs)
      .leftJoin(leads, eq(leads.id, callLogs.leadId))
      .leftJoin(agent, eq(agent.id, callLogs.agentUserId))
      .leftJoin(callInsights, eq(callInsights.callLogId, callLogs.id))
      .where(and(...conds))
      .orderBy(desc(callLogs.startedAt))
      .limit(pageSize + 1)
      .offset((page - 1) * pageSize),
  );
  return { rows: rows.slice(0, pageSize).map((r) => ({ ...r, leadPhone: r.leadPhone ? phone(user, r.leadPhone) : null })), hasMore: rows.length > pageSize, page };
}

export async function getCallDetail(db: Db, user: AuthUser, id: string) {
  const { where, aggregateOnly } = aggregateScope(user, "calls.read");
  if (aggregateOnly) throw new ForbiddenError("calls.read", "aggregate_only");
  const agent = aliasedTable(users, "agent");

  return withOrg(db, user.orgId, async (tx) => {
    const [call] = await tx
      .select({
        id: callLogs.id, orgId: callLogs.orgId, teamId: callLogs.teamId, agentUserId: callLogs.agentUserId, startedAt: callLogs.startedAt,
        direction: callLogs.direction, source: callLogs.source, status: callLogs.status, durationS: callLogs.durationS,
        recordingKey: callLogs.recordingKey, leadId: callLogs.leadId, leadName: leads.name, leadPhone: leads.phoneE164,
        agentEmail: agent.email, voiceLabel: voiceProfiles.label, handedOff: sql<boolean>`${callLogs.handoffToUserId} is not null`,
      })
      .from(callLogs)
      .leftJoin(leads, eq(leads.id, callLogs.leadId))
      .leftJoin(agent, eq(agent.id, callLogs.agentUserId))
      .leftJoin(voiceProfiles, eq(voiceProfiles.id, callLogs.voiceProfileId))
      .where(and(eq(callLogs.id, id), where));
    if (!call) return null;

    const resource = { orgId: call.orgId, teamId: call.teamId, ownerUserId: call.agentUserId };
    const canTranscript = authorize(user, "transcripts.read", resource).allowed;
    const canPlay = !!call.recordingKey && authorize(user, "recordings.play", resource).allowed;

    const [transcript] = canTranscript ? await tx.select().from(callTranscripts).where(eq(callTranscripts.callLogId, id)) : [];
    const [insight] = canTranscript ? await tx.select().from(callInsights).where(eq(callInsights.callLogId, id)) : [];
    return {
      call: { ...call, leadPhone: call.leadPhone ? phone(user, call.leadPhone) : null, recordingKey: undefined },
      canPlay, canTranscript, transcript: transcript ?? null, insight: insight ?? null,
    };
  });
}

/** Authorises and returns the recording key so the route can stream it; the caller audits the play. */
export async function getRecordingForPlay(db: Db, user: AuthUser, id: string) {
  return withOrg(db, user.orgId, async (tx) => {
    const [c] = await tx.select().from(callLogs).where(eq(callLogs.id, id));
    if (!c?.recordingKey) return null;
    const d = authorize(user, "recordings.play", { orgId: c.orgId, teamId: c.teamId, ownerUserId: c.agentUserId });
    if (!d.allowed) throw new ForbiddenError("recordings.play", d.reason);
    await writeAudit(tx, { orgId: user.orgId, teamId: c.teamId, actorUserId: user.id, action: "recording.play", entity: "call_logs", entityId: c.id });
    return { key: c.recordingKey, durationS: c.durationS };
  });
}

// -------------------------------------------------------------------- leads

export interface LeadFilters { q?: string; status?: string; page?: number }

export async function listLeads(db: Db, user: AuthUser, f: LeadFilters = {}) {
  const page = Math.max(1, f.page ?? 1);
  const conds: SQL[] = [scopeCondition(user, "leads.read", leadCols)];
  if (f.status) conds.push(eq(leads.status, f.status as LeadStatus));
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    conds.push(or(ilike(leads.name, like), ilike(leads.phoneE164, like), ilike(leads.email, like))!);
  }
  const owner = aliasedTable(users, "owner");
  const rows = await withOrg(db, user.orgId, (tx) =>
    tx
      .select({
        id: leads.id, name: leads.name, phone: leads.phoneE164, email: leads.email, source: leads.source, status: leads.status,
        score: leads.score, tags: leads.tags, dnd: leads.dndFlag, ownerEmail: owner.email,
        // Correlated subqueries use fully-qualified SQL: Drizzle drops table names from interpolated columns in single-table queries.
        lastCallAt: sql<string | null>`(select max(c.started_at) from call_logs c where c.lead_id = "leads"."id")`,
        callCount: num(sql`(select count(*) from call_logs c where c.lead_id = "leads"."id")`),
      })
      .from(leads)
      .leftJoin(owner, eq(owner.id, leads.ownerUserId))
      .where(and(...conds))
      .orderBy(desc(leads.createdAt))
      .limit(PAGE_SIZE + 1)
      .offset((page - 1) * PAGE_SIZE),
  );
  return { rows: rows.slice(0, PAGE_SIZE).map((r) => ({ ...r, phone: phone(user, r.phone) })), hasMore: rows.length > PAGE_SIZE, page };
}

export async function getLeadDetail(db: Db, user: AuthUser, id: string) {
  const owner = aliasedTable(users, "owner");
  return withOrg(db, user.orgId, async (tx) => {
    const [lead] = await tx
      .select({ lead: leads, ownerEmail: owner.email })
      .from(leads)
      .leftJoin(owner, eq(owner.id, leads.ownerUserId))
      .where(and(eq(leads.id, id), scopeCondition(user, "leads.read", leadCols)));
    if (!lead) return null;

    const actor = aliasedTable(users, "actor");
    const history = await tx
      .select({
        id: leadStatusHistory.id, from: leadStatusHistory.fromStatus, to: leadStatusHistory.toStatus, by: leadStatusHistory.changedBy,
        byEmail: actor.email, reason: leadStatusHistory.reason, confidence: leadStatusHistory.confidence, at: leadStatusHistory.createdAt,
      })
      .from(leadStatusHistory)
      .leftJoin(actor, eq(actor.id, leadStatusHistory.changedByUserId))
      .where(eq(leadStatusHistory.leadId, id))
      .orderBy(desc(leadStatusHistory.createdAt));

    return { lead: { ...lead.lead, phoneE164: phone(user, lead.lead.phoneE164) }, ownerEmail: lead.ownerEmail, history };
  });
}

export async function listLeadOptions(db: Db, user: AuthUser) {
  assertAuthorized(user, "calls.place");
  return withOrg(db, user.orgId, (tx) =>
    tx
      .select({ id: leads.id, name: leads.name, phone: leads.phoneE164, dnd: leads.dndFlag })
      .from(leads)
      .where(scopeCondition(user, "leads.read", leadCols))
      .orderBy(leads.name)
      .limit(200),
  );
}

// ------------------------------------------------------------------ reports

export async function agentProductivity(db: Db, user: AuthUser, days = 7) {
  const { where, aggregateOnly } = aggregateScope(user, "reports.read");
  const inRange = and(where, gte(callLogs.startedAt, day(days)))!;
  const agent = aliasedTable(users, "agent");

  return withOrg(db, user.orgId, async (tx) => {
    const rows = await tx
      .select({
        agentId: callLogs.agentUserId,
        email: agent.email,
        connected: num(sql`count(*) filter (where ${callLogs.status} = 'connected')`),
        outAttempts: num(sql`count(*) filter (where ${callLogs.direction} = 'outbound')`),
        outConnected: num(sql`count(*) filter (where ${callLogs.direction} = 'outbound' and ${callLogs.status} = 'connected')`),
        talkSeconds: num(sql`coalesce(sum(${callLogs.durationS}) filter (where ${callLogs.status} = 'connected'), 0)`),
        missedIn: num(sql`count(*) filter (where ${callLogs.direction} = 'inbound' and ${callLogs.status} = 'missed')`),
        // SOP: a missed incoming call with no outgoing call to that lead within 24 h.
        neverReturned: num(sql`count(*) filter (where "call_logs"."direction" = 'inbound' and "call_logs"."status" = 'missed' and not exists (
          select 1 from call_logs o where o.lead_id = "call_logs"."lead_id" and o.direction = 'outbound'
          and o.started_at > "call_logs"."started_at" and o.started_at <= "call_logs"."started_at" + interval '24 hours'))`),
        avgSentiment: sql<number | null>`avg(${callInsights.sentimentScore})`.mapWith((v) => (v === null ? null : Number(v))),
        firstCall: sql<string | null>`min(${callLogs.startedAt})`,
        lastCall: sql<string | null>`max(${callLogs.startedAt})`,
      })
      .from(callLogs)
      .leftJoin(agent, eq(agent.id, callLogs.agentUserId))
      .leftJoin(callInsights, eq(callInsights.callLogId, callLogs.id))
      .where(and(inRange, sql`${callLogs.agentUserId} is not null`))
      .groupBy(callLogs.agentUserId, agent.email)
      .orderBy(desc(sql`count(*)`));

    const totals = rows.reduce(
      (a, r) => ({ connected: a.connected + r.connected, talkSeconds: a.talkSeconds + r.talkSeconds, neverReturned: a.neverReturned + r.neverReturned, outAttempts: a.outAttempts + r.outAttempts, outConnected: a.outConnected + r.outConnected }),
      { connected: 0, talkSeconds: 0, neverReturned: 0, outAttempts: 0, outConnected: 0 },
    );
    return { aggregateOnly, days, totals, rows: aggregateOnly ? [] : rows };
  });
}

// --------------------------------------------------------- voices & consent

export async function listVoiceAdmin(db: Db, user: AuthUser) {
  assertAuthorized(user, "voice_profiles.manage");
  const donor = aliasedTable(users, "donor");
  return withOrg(db, user.orgId, async (tx) => {
    const profiles = await tx
      .select({
        id: voiceProfiles.id, label: voiceProfiles.label, gender: voiceProfiles.gender, provider: voiceProfiles.provider,
        status: voiceProfiles.status, createdAt: voiceProfiles.createdAt, revokedAt: voiceProfiles.revokedAt,
        donorEmail: donor.email, consentId: voiceProfiles.consentRecordId, consentGrantedAt: consentRecords.grantedAt,
        consentPurpose: consentRecords.purpose, consentWithdrawn: consentRecords.revokedAt,
      })
      .from(voiceProfiles)
      .innerJoin(donor, eq(donor.id, voiceProfiles.donorUserId))
      .innerJoin(consentRecords, eq(consentRecords.id, voiceProfiles.consentRecordId))
      .orderBy(desc(voiceProfiles.createdAt));

    const consents = await tx
      .select({
        id: consentRecords.id, subjectId: consentRecords.subjectId, purpose: consentRecords.purpose, method: consentRecords.method,
        grantedAt: consentRecords.grantedAt, revokedAt: consentRecords.revokedAt, email: donor.email,
        inUse: sql<boolean>`exists (select 1 from voice_profiles vp where vp.consent_record_id = "consent_records"."id")`,
      })
      .from(consentRecords)
      .leftJoin(donor, eq(donor.id, consentRecords.subjectId))
      .where(eq(consentRecords.subjectType, "staff"))
      .orderBy(desc(consentRecords.grantedAt));

    const staff = await tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.status, "active")).orderBy(users.email);
    return { profiles, consents, staff };
  });
}

// --------------------------------------------------------------- knowledge

export async function listKnowledge(db: Db, user: AuthUser) {
  assertAuthorized(user, "kb.read");
  return withOrg(db, user.orgId, (tx) =>
    tx
      .select({
        id: kbDocuments.id, title: kbDocuments.title, sourceUrl: kbDocuments.sourceUrl, createdAt: kbDocuments.createdAt,
        chunks: num(sql`(select count(*) from kb_chunks c where c.document_id = "kb_documents"."id")`),
      })
      .from(kbDocuments)
      .orderBy(desc(kbDocuments.createdAt)),
  );
}

// -------------------------------------------------------------- team/devices

const userCols = (): Parameters<typeof scopeCondition>[2] => ({ orgId: users.orgId, teamId: users.teamId, ownerUserId: users.id });

export async function listTeam(db: Db, user: AuthUser) {
  const where = scopeCondition(user, "users.read", userCols());
  return withOrg(db, user.orgId, async (tx) => {
    const members = await tx
      .select({
        id: users.id, email: users.email, status: users.status, lastLoginAt: users.lastLoginAt, mfa: sql<boolean>`${users.mfaSecretEnc} is not null`,
        roles: sql<string[]>`coalesce((select array_agg(r.key order by r.key) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = "users"."id"), '{}')`,
      })
      .from(users)
      .where(where)
      .orderBy(users.email);

    const deviceRows = await tx
      .select({ id: devices.id, email: users.email, platform: devices.platform, workSimSlot: devices.workSimSlot, lastSyncAt: devices.lastSyncAt, revokedAt: devices.revokedAt })
      .from(devices)
      .innerJoin(users, eq(users.id, devices.userId))
      .where(where)
      .orderBy(users.email);
    return { members, devices: deviceRows, canRevoke: !!resolveScope(user, "devices.revoke") };
  });
}

export async function revokeDevice(db: Db, user: AuthUser, deviceId: string) {
  return withOrg(db, user.orgId, async (tx) => {
    const [row] = await tx
      .select({ d: devices, teamId: users.teamId, userId: users.id })
      .from(devices)
      .innerJoin(users, eq(users.id, devices.userId))
      .where(eq(devices.id, deviceId));
    if (!row) return false;
    assertAuthorized(user, "devices.revoke", { orgId: row.d.orgId, teamId: row.teamId, ownerUserId: row.userId });
    if (row.d.revokedAt) return true;
    await tx.update(devices).set({ revokedAt: new Date() }).where(eq(devices.id, deviceId));
    await writeAudit(tx, { orgId: user.orgId, actorUserId: user.id, action: "device.revoke", entity: "devices", entityId: deviceId });
    return true;
  });
}

// -------------------------------------------------------------------- audit

export async function listAudit(db: Db, user: AuthUser, f: { page?: number; action?: string } = {}) {
  assertAuthorized(user, "audit.read");
  const page = Math.max(1, f.page ?? 1);
  const size = 25;
  const rows = await withOrg(db, user.orgId, (tx) =>
    tx
      .select({ id: auditLogs.id, at: auditLogs.at, action: auditLogs.action, entity: auditLogs.entity, entityId: auditLogs.entityId, ip: auditLogs.ip, actorEmail: users.email })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorUserId))
      .where(f.action ? ilike(auditLogs.action, `${f.action}%`) : undefined)
      .orderBy(desc(auditLogs.at))
      .limit(size + 1)
      .offset((page - 1) * size),
  );
  return { rows: rows.slice(0, size), hasMore: rows.length > size, page };
}

// ----------------------------------------------------------------- settings

export async function getOrgSettings(db: Db, user: AuthUser) {
  const canView = ["org_settings.read", "ai_prompts.read"].some((p) => user.permissions.includes(p));
  if (!canView) throw new ForbiddenError("org_settings.read");
  const [org] = await withOrg(db, user.orgId, (tx) => tx.select().from(organizations).where(eq(organizations.id, user.orgId)));
  return {
    name: org!.name,
    settings: orgSettingsSchema.parse(org!.settingsJson),
    dataRetentionDays: org!.dataRetentionDays,
    recordingRetentionDays: org!.recordingRetentionDays,
    canEdit: user.permissions.includes("org_settings.write") && user.permissions.includes("ai_prompts.write"),
  };
}

export async function updateOrgSettings(db: Db, user: AuthUser, raw: unknown) {
  assertAuthorized(user, "org_settings.write");
  assertAuthorized(user, "ai_prompts.write");
  const input = orgSettingsUpdateSchema.parse(raw);
  return withOrg(db, user.orgId, async (tx) => {
    const [before] = await tx.select().from(organizations).where(eq(organizations.id, user.orgId));
    await tx
      .update(organizations)
      .set({ settingsJson: input.settings, dataRetentionDays: input.dataRetentionDays, recordingRetentionDays: input.recordingRetentionDays })
      .where(eq(organizations.id, user.orgId));
    await writeAudit(tx, {
      orgId: user.orgId, actorUserId: user.id, action: "org_settings.update", entity: "organizations", entityId: user.orgId,
      before: { settings: before!.settingsJson, dataRetentionDays: before!.dataRetentionDays, recordingRetentionDays: before!.recordingRetentionDays },
      after: input,
    });
  });
}

// ------------------------------------------------------------------ profile

export async function getUserProfile(db: Db, user: AuthUser) {
  return withOrg(db, user.orgId, async (tx) => {
    const [row] = await tx
      .select({
        email: users.email, orgName: organizations.name,
        roles: sql<string[]>`coalesce((select array_agg(r.key order by r.key) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = "users"."id"), '{}')`,
      })
      .from(users)
      .innerJoin(organizations, eq(organizations.id, users.orgId))
      .where(eq(users.id, user.id));
    return row ?? { email: "", orgName: "", roles: [] as string[] };
  });
}

/** Outbound calling window for anyone who may place calls (they cannot read the full settings page). */
export async function getCallingWindow(db: Db, user: AuthUser) {
  assertAuthorized(user, "calls.place");
  const [org] = await withOrg(db, user.orgId, (tx) => tx.select({ s: organizations.settingsJson }).from(organizations).where(eq(organizations.id, user.orgId)));
  return orgSettingsSchema.parse(org!.s).calling;
}

/** AI behaviour settings for the agent console; any studio user may read the prompt they are testing. */
export async function getAgentConfig(db: Db, user: AuthUser) {
  assertAuthorized(user, "studio.use");
  const [org] = await withOrg(db, user.orgId, (tx) => tx.select({ s: organizations.settingsJson }).from(organizations).where(eq(organizations.id, user.orgId)));
  return orgSettingsSchema.parse(org!.s).ai;
}
