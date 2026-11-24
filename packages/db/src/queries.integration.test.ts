import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, ROLE_PERMISSIONS, type AuthUser, type RoleKey } from "@voiceai/auth";
import { createDb } from "./client";
import { streamContactsCsv } from "./contacts";
import { agentProductivity, dashboardStats, getCallDetail, getLeadDetail, listCalls, listLeads, listTeam, listAudit, listKnowledge, listVoiceAdmin } from "./queries";
import { ingestKnowledge } from "./studio";
import { callLogs, consentRecords, leads, organizations, roles, teams, userRoles, users, voiceProfiles } from "./schema";

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("role-scoped queries", () => {
  const owner = createDb(ownerUrl ?? "");
  const app = createDb(appUrl ?? "");
  const x = {} as Record<string, string>;
  const tag = randomUUID().slice(0, 8);

  const as = (role: RoleKey, id: string, teamIds: string[], orgId = x.org!): AuthUser => ({ id, orgId, teamIds, permissions: ROLE_PERMISSIONS[role] });

  beforeAll(async () => {
    const db = owner.db;
    const [org, other] = await db.insert(organizations).values([{ name: `Q-${tag}` }, { name: `Other-${tag}` }]).returning();
    const [tN, tS] = await db.insert(teams).values([{ orgId: org!.id, name: "North" }, { orgId: org!.id, name: "South" }]).returning();
    const mk = (email: string, teamId: string) => ({ orgId: org!.id, teamId, email: `${email}-${tag}@x.io`, passwordHash: "x" });
    const [aN, aS] = await db.insert(users).values([mk("an", tN!.id), mk("as", tS!.id)]).returning();
    const [lN, lS] = await db.insert(leads).values([
      { orgId: org!.id, teamId: tN!.id, ownerUserId: aN!.id, name: "North Lead", phoneE164: "+919810000001", tags: ["vip", "follow-up"], consentStatus: "granted" },
      { orgId: org!.id, teamId: tS!.id, ownerUserId: aS!.id, name: "South Lead", phoneE164: "+919810000002", tags: ["follow-up"], consentStatus: "denied", dndFlag: true },
    ]).returning();
    await db.insert(leads).values({ orgId: other!.id, phoneE164: "+919810000003", name: "Other Org Lead" });
    const call = (agent: typeof aN, team: typeof tN, lead: typeof lN) => ({
      orgId: org!.id, teamId: team!.id, leadId: lead!.id, agentUserId: agent!.id, direction: "outbound" as const, source: "web_dialer" as const,
      status: "connected" as const, startedAt: new Date(Date.now() - 3600_000), durationS: 60,
    });
    const [cN, cS] = await db.insert(callLogs).values([call(aN, tN, lN), call(aS, tS, lS)]).returning();
    Object.assign(x, { org: org!.id, other: other!.id, tN: tN!.id, tS: tS!.id, aN: aN!.id, aS: aS!.id, lN: lN!.id, lS: lS!.id, cN: cN!.id, cS: cS!.id });
  });
  afterAll(async () => { await owner.pool.end(); await app.pool.end(); });

  it("lists only what the role's scope allows", async () => {
    const names = async (u: AuthUser) => (await listLeads(app.db, u)).rows.map((r) => r.name).sort();
    expect(await names(as("org_admin", "admin", []))).toEqual(["North Lead", "South Lead"]);
    expect(await names(as("manager", "m", [x.tN!]))).toEqual(["North Lead"]);
    expect(await names(as("agent", x.aS!, [x.tS!]))).toEqual(["South Lead"]);
  });

  it("filters by exact tag, consent and DND while counting only scoped matches", async () => {
    const admin = as("org_admin", "admin", []);
    const north = await listLeads(app.db, admin, { tag: "VIP", consent: "granted", dnd: "false" });
    expect(north.rows.map((r) => r.name)).toEqual(["North Lead"]);
    expect(north.total).toBe(1);

    const south = await listLeads(app.db, as("manager", "m", [x.tS!]), { tag: "follow-up", consent: "denied", dnd: "true" });
    expect(south.rows.map((r) => r.name)).toEqual(["South Lead"]);
    expect(south.total).toBe(1);
    expect((await listLeads(app.db, admin, { tag: "missing" })).total).toBe(0);
  });

  it("exports only the matching contacts within the export scope", async () => {
    // The export is audited with the actor's id, which must be a real user (the audit log's actor column references users).
    const admin = as("org_admin", x.aN!, []);
    const csv = await new Response(streamContactsCsv(app.db, admin, { tag: "VIP", consent: "granted", dnd: "false" })).text();
    expect(csv).toContain("North Lead");
    expect(csv).not.toContain("South Lead");
    expect(csv).not.toContain("Other Org Lead");
  });

  it("hides out-of-scope records from detail views (returns null, same as a missing id)", async () => {
    const north = as("manager", "m", [x.tN!]);
    expect(await getLeadDetail(app.db, north, x.lS!)).toBeNull();
    expect(await getLeadDetail(app.db, north, x.lN!)).not.toBeNull();
    expect(await getCallDetail(app.db, north, x.cS!)).toBeNull();
    expect(await getCallDetail(app.db, as("agent", x.aN!, [x.tN!]), x.cS!)).toBeNull();
  });

  it("never lets one org read another's data, even for admins", async () => {
    const adminOfOther = as("org_admin", "a2", [], x.other!);
    expect((await listLeads(app.db, adminOfOther)).rows.map((r) => r.name)).toEqual(["Other Org Lead"]);
    expect(await getLeadDetail(app.db, adminOfOther, x.lN!)).toBeNull();
  });

  it("scopes call lists, reports and team lists the same way", async () => {
    const north = as("manager", "m", [x.tN!]);
    expect((await listCalls(app.db, north)).rows.map((r) => r.id)).toEqual([x.cN]);
    expect((await agentProductivity(app.db, north)).rows.map((r) => r.agentId)).toEqual([x.aN]);
    expect((await agentProductivity(app.db, as("agent", x.aS!, [x.tS!]))).rows.map((r) => r.agentId)).toEqual([x.aS]);
    expect((await listTeam(app.db, north)).members.every((m) => m.email.startsWith("an-"))).toBe(true);
  });

  it("gives aggregate-only roles totals but no records, and no admin pages to non-admins", async () => {
    const viewer = as("viewer", "v", []);
    const d = await dashboardStats(app.db, viewer);
    expect(d.aggregateOnly).toBe(true);
    expect(d.totals.total).toBe(2);
    await expect(listCalls(app.db, viewer)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listLeads(app.db, viewer)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await agentProductivity(app.db, viewer)).rows).toEqual([]);
    await expect(listAudit(app.db, as("manager", "m", [x.tN!]))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("computes correlated figures correctly: lead call counts, team roles, passages, consent use", async () => {
    const admin = as("org_admin", x.aN!, []);
    const north = (await listLeads(app.db, admin)).rows.find((r) => r.name === "North Lead")!;
    expect(north.callCount).toBe(1);
    expect(north.lastCallAt).not.toBeNull();

    const [role] = await owner.db.insert(roles).values({ key: `qa-role-${tag}`, name: "x", permissions: [] }).returning();
    await owner.db.insert(userRoles).values({ userId: x.aN!, roleId: role!.id });
    const member = (await listTeam(app.db, admin)).members.find((m) => m.id === x.aN)!;
    expect(member.roles).toEqual([`qa-role-${tag}`]);

    const doc = await ingestKnowledge(app.db, admin, { title: "Passage count", text: "One short paragraph about pricing." });
    expect((await listKnowledge(app.db, admin)).find((d) => d.id === doc.id)!.chunks).toBe(1);

    const [consent] = await owner.db.insert(consentRecords).values({ orgId: x.org!, subjectType: "staff", subjectId: x.aN!, purpose: "p", method: "m", documentUrl: "d", grantedAt: new Date() }).returning();
    const before = (await listVoiceAdmin(app.db, admin)).consents.find((c) => c.id === consent!.id)!;
    expect(before.inUse).toBe(false);
    await owner.db.insert(voiceProfiles).values({ orgId: x.org!, label: "v", gender: "male", providerVoiceId: `pv-${tag}`, donorUserId: x.aN!, consentRecordId: consent!.id });
    expect((await listVoiceAdmin(app.db, admin)).consents.find((c) => c.id === consent!.id)!.inUse).toBe(true);
  });

  it("counts a missed inbound call as 'never returned' only when no outbound call follows within 24 h", async () => {
    const t0 = new Date(Date.now() - 6 * 3600_000);
    const base = { orgId: x.org!, teamId: x.tN!, agentUserId: x.aN!, status: "missed" as const, direction: "inbound" as const, source: "mobile_sim" as const, durationS: 0 };
    const [l1, l2] = await owner.db.insert(leads).values([{ orgId: x.org!, teamId: x.tN!, phoneE164: "+919810000091" }, { orgId: x.org!, teamId: x.tN!, phoneE164: "+919810000092" }]).returning();
    await owner.db.insert(callLogs).values([
      { ...base, leadId: l1!.id, startedAt: t0 },
      { ...base, leadId: l2!.id, startedAt: t0 },
      { ...base, leadId: l2!.id, direction: "outbound", status: "connected", startedAt: new Date(t0.getTime() + 3600_000), durationS: 30 },
    ]);
    const row = (await agentProductivity(app.db, as("manager", "m", [x.tN!]))).rows.find((r) => r.agentId === x.aN)!;
    expect(row.missedIn).toBe(2);
    expect(row.neverReturned).toBe(1); // l1 was never called back; l2 was
  });
});
