import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, type AuthUser } from "@voiceai/auth";
import { createDb, withOrg } from "./client";
import { saveAiCall, checkOutboundCall, findLeadIdByPhone, getLeadPhone } from "./call-records";
import { authenticateDevice, checkOutboundNumber, createPairingCode, findDeviceCall, forgetDevice, logDialerCall, registerDevice, setRecordingKey, syncDeviceCalls } from "./mobile";
import { revokeDevice } from "./queries";
import { auditLogs, callAnalysisAttempts, callInsights, callLogs, callTranscripts, consentRecords, devicePairingCodes, devices, leadStatusHistory, leads, organizations, roles, teams, userRoles, users } from "./schema";
import { applySuggestedStatus, countFailedAnalyses, listExpiredRecordings, listExpiredTranscripts, listPendingAnalysis, purgeRecording, purgeTranscript, recordAnalysisFailure, requeueAnalysis, saveAnalysis } from "./post-call";
import { listCalls } from "./queries";
import { scopedRepos } from "./scoped";
import { createVoiceProfile, findOrCreateVoiceDonor, listSelectableVoices, updateVoiceProfile, resolveCallVoice, revokeVoiceProfile } from "./voice-profiles";

// Owner connection seeds data; TEST_APP_DATABASE_URL is a NON-owner role so RLS actually applies.
const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("integration", () => {
  const owner = createDb(ownerUrl ?? "");
  const app = createDb(appUrl ?? "");
  const ids = {} as Record<string, string>;

  beforeAll(async () => {
    const db = owner.db;
    const [o1, o2] = await db.insert(organizations).values([{ name: "Org1" }, { name: "Org2" }]).returning();
    const [tA, tB] = await db.insert(teams).values([{ orgId: o1!.id, name: "A" }, { orgId: o1!.id, name: "B" }]).returning();
    const [mgr, admin] = await db
      .insert(users)
      .values([
        { orgId: o1!.id, teamId: tA!.id, email: `m-${Date.now()}@x.io`, passwordHash: "x" },
        { orgId: o1!.id, email: `a-${Date.now()}@x.io`, passwordHash: "x" },
      ])
      .returning();
    await db.insert(leads).values([
      { orgId: o1!.id, teamId: tA!.id, phoneE164: "+919800000001" },
      { orgId: o1!.id, teamId: tB!.id, phoneE164: "+919800000002" },
      { orgId: o2!.id, phoneE164: "+919800000003" },
    ]);
    Object.assign(ids, { o1: o1!.id, o2: o2!.id, tA: tA!.id, tB: tB!.id, mgr: mgr!.id, admin: admin!.id });
  });

  afterAll(async () => {
    await owner.pool.end();
    await app.pool.end();
  });

  const user = (role: keyof typeof ROLE_PERMISSIONS, id: string, teamIds: string[]): AuthUser => ({
    id,
    orgId: ids.o1!,
    teamIds,
    permissions: ROLE_PERMISSIONS[role],
  });

  it("a Manager only sees their own team's leads", async () => {
    const rows = await withOrg(app.db, ids.o1!, (tx) => scopedRepos(tx as never, user("manager", ids.mgr!, [ids.tA!])).leads.list());
    expect(rows.map((r) => r.phoneE164)).toEqual(["+919800000001"]);
  });

  it("RLS hides other orgs even when the query forgets the org filter", async () => {
    const rows = await withOrg(app.db, ids.o1!, (tx) => tx.select().from(leads));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.orgId === ids.o1)).toBe(true);
    // No org context at all: nothing is visible.
    expect(await app.db.select().from(leads)).toHaveLength(0);
  });

  it("voice profiles: consent required, revocation is audited and blocks use", async () => {
    const admin = user("org_admin", ids.admin!, []);
    const [consent] = await owner.db
      .insert(consentRecords)
      .values({ orgId: ids.o1!, subjectType: "staff", subjectId: ids.mgr!, purpose: "ai calls", method: "written_signed", documentUrl: "s3://c/1.pdf", grantedAt: new Date() })
      .returning();
    const input = { label: "Priya", gender: "female", providerVoiceId: `v-${Date.now()}`, donorUserId: ids.mgr!, consentRecordId: consent!.id };

    await expect(createVoiceProfile(app.db, user("agent", "a", []), input)).rejects.toThrow(/Forbidden/);
    await expect(createVoiceProfile(app.db, admin, { ...input, donorUserId: ids.admin! })).rejects.toThrow(/does not belong/);

    const profile = await createVoiceProfile(app.db, admin, input);
    expect((await listSelectableVoices(app.db, ids.o1!, "female")).map((v) => v.id)).toContain(profile.id);
    expect((await resolveCallVoice(app.db, ids.o1!, { voiceProfileId: profile.id })).id).toBe(profile.id);

    const deleted: string[] = [];
    await revokeVoiceProfile(app.db, admin, profile.id, async (v) => void deleted.push(v));
    expect(deleted).toEqual([input.providerVoiceId]);
    await expect(resolveCallVoice(app.db, ids.o1!, { voiceProfileId: profile.id })).rejects.toThrow(/not active/);
    await expect(createVoiceProfile(app.db, admin, { ...input, providerVoiceId: "other" })).rejects.toThrow(/withdrawn/);

    const audit = await owner.db.execute(sql`select action from audit_logs where entity_id = ${profile.id} order by at`);
    expect(audit.rows.map((r) => r.action)).toEqual(["voice_profile.create", "voice_profile.revoke"]);
  });

  it("voice donors: found or added by first and last name, cannot sign in, never duplicated, audited", async () => {
    const admin = user("org_admin", ids.admin!, []);
    const first = await findOrCreateVoiceDonor(app.db, admin, "  Karan ", "Devda");
    expect(first).toMatchObject({ firstName: "Karan", lastName: "Devda", created: true });
    const again = await findOrCreateVoiceDonor(app.db, admin, "karan", "DEVDA"); // same person, different case and spacing
    expect(again).toMatchObject({ id: first.id, created: false });
    expect((await findOrCreateVoiceDonor(app.db, admin, "Mahak", "Sharma")).id).not.toBe(first.id);

    await expect(findOrCreateVoiceDonor(app.db, admin, "Karan", "  ")).rejects.toThrow(/last name/);
    await expect(findOrCreateVoiceDonor(app.db, user("agent", "a", []), "A", "B")).rejects.toThrow(/Forbidden/);

    const row = await owner.db.execute(sql`select status, password_hash, email from users where id = ${first.id}`);
    expect(row.rows[0]).toMatchObject({ status: "disabled", password_hash: "!" });
    expect(String(row.rows[0]!.email)).toMatch(/@voice-donor\.invalid$/);
    const audit = await owner.db.execute(sql`select count(*)::int as n from audit_logs where entity_id = ${first.id} and action = 'voice_donor.create'`);
    expect(audit.rows[0]!.n).toBe(1);

    // another organisation's person with the same name is not matched
    const other: AuthUser = { id: ids.admin!, orgId: ids.o2!, teamIds: [], permissions: ROLE_PERMISSIONS.org_admin };
    expect((await findOrCreateVoiceDonor(app.db, other, "Karan", "Devda")).id).not.toBe(first.id);
  });

  it("a voice's name and gender can be corrected, audited, and a revoked voice cannot be edited", async () => {
    const admin = user("org_admin", ids.admin!, []);
    const [consent] = await owner.db
      .insert(consentRecords)
      .values({ orgId: ids.o1!, subjectType: "staff", subjectId: ids.mgr!, purpose: "edit test", method: "written_signed", documentUrl: "s3://c/2.pdf", grantedAt: new Date() })
      .returning();
    const v = await createVoiceProfile(app.db, admin, { label: "Karan", gender: "female", providerVoiceId: `edit-${Date.now()}`, donorUserId: ids.mgr!, consentRecordId: consent!.id });
    const fixed = await updateVoiceProfile(app.db, admin, v.id, { label: "  Karan   Devda ", gender: "male" });
    expect(fixed).toMatchObject({ label: "Karan Devda", gender: "male" });
    expect((await listSelectableVoices(app.db, ids.o1!, "male")).map((x) => x.id)).toContain(v.id);
    expect((await listSelectableVoices(app.db, ids.o1!, "female")).map((x) => x.id)).not.toContain(v.id);

    await expect(updateVoiceProfile(app.db, admin, v.id, { label: "  ", gender: "male" })).rejects.toThrow(/name/);
    await expect(updateVoiceProfile(app.db, admin, v.id, { label: "x".repeat(81), gender: "male" })).rejects.toThrow(/80/);
    await expect(updateVoiceProfile(app.db, admin, v.id, { label: "Karan", gender: "other" })).rejects.toThrow(/male or female/);
    await expect(updateVoiceProfile(app.db, user("agent", "a", []), v.id, { label: "Hacked", gender: "male" })).rejects.toThrow(/Forbidden/);
    expect(await updateVoiceProfile(app.db, admin, v.id, { label: "Karan Devda", gender: "male" })).toMatchObject({ id: v.id }); // no change: not audited twice

    const audit = await owner.db.execute(sql`select before, after from audit_logs where entity_id = ${v.id} and action = 'voice_profile.update'`);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ before: { label: "Karan", gender: "female" }, after: { label: "Karan Devda", gender: "male" } });

    await revokeVoiceProfile(app.db, admin, v.id, async () => {});
    await expect(updateVoiceProfile(app.db, admin, v.id, { label: "Again", gender: "male" })).rejects.toThrow(/revoked/);
  });

  it("finds a lead by phone number and a number by lead, only inside the organisation", async () => {
    const admin = user("org_admin", ids.admin!, []);
    const id = await findLeadIdByPhone(app.db, admin, "+919800000001");
    expect(id).toBeTruthy();
    expect(await getLeadPhone(app.db, admin, id!)).toBe("+919800000001");
    expect(await findLeadIdByPhone(app.db, admin, "+919800000003")).toBeNull(); // that number is a lead in the other organisation
    expect(await findLeadIdByPhone(app.db, admin, "+910000000000")).toBeNull();
    expect(await getLeadPhone(app.db, admin, "00000000-0000-4000-8000-000000000000")).toBeNull();
    await expect(findLeadIdByPhone(app.db, user("viewer", "v", []), "+919800000001")).rejects.toThrow(/Forbidden/);
  });

  it("saves a finished AI call with its transcript once, marks silence as missed, and audits a handoff", async () => {
    const admin = user("org_admin", ids.admin!, []);
    const segments = [
      { speaker: "ai" as const, startMs: 0, endMs: 2000, text: "Hello, I am an AI assistant." },
      { speaker: "caller" as const, startMs: 2500, endMs: 4000, text: "I want to talk to a person." },
      { speaker: "ai" as const, startMs: 4500, endMs: 6000, text: "Let me connect you with a colleague.", interrupted: false },
    ];
    const uuid = `call-${Date.now()}`;
    const first = await saveAiCall(app.db, admin, { providerCallUuid: uuid, direction: "inbound", source: "ai_inbound", startedAt: new Date(), durationS: 41.6, segments, language: "en", handoff: { reason: "caller asked for a person" } });
    expect(first.created).toBe(true);
    const again = await saveAiCall(app.db, admin, { providerCallUuid: uuid, direction: "inbound", source: "ai_inbound", startedAt: new Date(), durationS: 99, segments: [], language: "en" });
    expect(again).toEqual({ id: first.id, created: false }); // a retry changes nothing

    const [log] = await owner.db.select().from(callLogs).where(sql`${callLogs.id} = ${first.id}`);
    expect(log).toMatchObject({ status: "connected", durationS: 42, source: "ai_inbound", direction: "inbound", orgId: ids.o1 });
    const [tr] = await owner.db.select().from(callTranscripts).where(sql`${callTranscripts.callLogId} = ${first.id}`);
    expect(tr!.segments).toHaveLength(3);
    const audit = await owner.db.select().from(auditLogs).where(sql`${auditLogs.entityId} = ${first.id} and ${auditLogs.action} = 'call.handoff_requested'`);
    expect(audit).toHaveLength(1);

    const silent = await saveAiCall(app.db, admin, { providerCallUuid: `${uuid}-silent`, direction: "inbound", source: "ai_inbound", startedAt: new Date(), durationS: 8, segments: [segments[0]!], language: "en" });
    const [missed] = await owner.db.select().from(callLogs).where(sql`${callLogs.id} = ${silent.id}`);
    expect(missed!.status).toBe("missed");

    await expect(saveAiCall(app.db, user("viewer", "v", []), { providerCallUuid: `${uuid}-v`, direction: "inbound", source: "ai_inbound", startedAt: new Date(), durationS: 1, segments, language: "en" })).rejects.toThrow(/Forbidden/);
  });

  it("outbound calls are blocked for Do Not Disturb, withdrawn consent, outside hours, unknown and other-organisation leads, and each block is audited", async () => {
    const admin = user("org_admin", ids.admin!, []);
    const [normal, dnd, withdrawn] = await owner.db.insert(leads).values([
      { orgId: ids.o1!, phoneE164: `+9198${Date.now().toString().slice(-8)}`, consentStatus: "granted" },
      { orgId: ids.o1!, phoneE164: `+9197${Date.now().toString().slice(-8)}`, dndFlag: true },
      { orgId: ids.o1!, phoneE164: `+9196${Date.now().toString().slice(-8)}`, consentStatus: "withdrawn" },
    ]).returning();
    const [foreign] = await owner.db.select().from(leads).where(sql`${leads.orgId} = ${ids.o2}`);
    const noon = new Date("2026-10-26T06:30:00Z"), night = new Date("2026-10-26T20:00:00Z"); // 12:00 and 01:30 India time

    expect(await checkOutboundCall(app.db, admin, normal!.id, noon)).toEqual({ allowed: true });
    expect(await checkOutboundCall(app.db, admin, dnd!.id, noon)).toEqual({ allowed: false, reason: "dnd" });
    expect(await checkOutboundCall(app.db, admin, withdrawn!.id, noon)).toEqual({ allowed: false, reason: "consent_withdrawn" });
    expect(await checkOutboundCall(app.db, admin, normal!.id, night)).toEqual({ allowed: false, reason: "outside_hours" });
    expect(await checkOutboundCall(app.db, admin, "00000000-0000-4000-8000-000000000000", noon)).toEqual({ allowed: false, reason: "unknown_lead" });
    expect(await checkOutboundCall(app.db, admin, foreign!.id, noon)).toEqual({ allowed: false, reason: "unknown_lead" }); // another organisation's lead looks the same
    await expect(checkOutboundCall(app.db, user("viewer", "v", []), normal!.id, noon)).rejects.toThrow(/Forbidden/);

    const blocked = await owner.db.select().from(auditLogs).where(sql`${auditLogs.action} = 'call.blocked' and ${auditLogs.entityId} in (${normal!.id}, ${dnd!.id}, ${withdrawn!.id})`);
    expect(blocked.map((b) => (b.after as { reason: string }).reason).sort()).toEqual(["consent_withdrawn", "dnd", "outside_hours"]);
  });

  describe("phones (Android and iOS)", () => {
    const fp = (n: string) => `fingerprint-${n}-${"x".repeat(20)}`;
    let agent: AuthUser;
    const pair = async (n = "a") => {
      const { code } = await createPairingCode(app.db, agent);
      return registerDevice(app.db, { code, fingerprint: fp(n), platform: "android", name: "Test phone", workSimSlot: 0 });
    };

    beforeAll(async () => {
      const [role] = await owner.db.insert(roles).values({ orgId: ids.o1!, key: `phone-agent-${Date.now()}`, name: "Phone agent", permissions: ["calls.place", "leads.read.all"] }).returning();
      const [u] = await owner.db.insert(users).values({ orgId: ids.o1!, teamId: ids.tA!, email: `phone-${Date.now()}@x.io`, passwordHash: "x" }).returning();
      await owner.db.insert(userRoles).values({ userId: u!.id, roleId: role!.id });
      agent = { id: u!.id, orgId: ids.o1!, teamIds: [ids.tA!], permissions: ["calls.place", "leads.read.all"] };
    });

    it("pairs with a one-time code, and the code cannot be used twice", async () => {
      const { code } = await createPairingCode(app.db, agent);
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      const first = await registerDevice(app.db, { code, fingerprint: fp("once"), platform: "ios", name: "iPhone" });
      expect(first?.token).toMatch(/^vd_/);
      expect(await registerDevice(app.db, { code, fingerprint: fp("twice"), platform: "ios" })).toBeNull();
      const [row] = await owner.db.select().from(devices).where(sql`${devices.id} = ${first!.deviceId}`);
      expect(row!.tokenHash).not.toContain(first!.token); // only a hash is stored
      expect(row!.platform).toBe("ios");
    });

    it("rejects a wrong, expired or reused code, and a viewer cannot make one", async () => {
      expect(await registerDevice(app.db, { code: "ABCD-2345", fingerprint: fp("bad"), platform: "android" })).toBeNull();
      const { code } = await createPairingCode(app.db, agent, new Date(Date.now() - 11 * 60_000)); // made 11 minutes ago
      expect(await registerDevice(app.db, { code, fingerprint: fp("late"), platform: "android" })).toBeNull();
      await expect(createPairingCode(app.db, user("viewer", "v", []))).rejects.toThrow(/Forbidden/);
    });

    it("a new code replaces the earlier unused one", async () => {
      const { code: old } = await createPairingCode(app.db, agent);
      await createPairingCode(app.db, agent);
      expect(await registerDevice(app.db, { code: old, fingerprint: fp("old"), platform: "android" })).toBeNull();
      expect((await owner.db.select().from(devicePairingCodes).where(sql`${devicePairingCodes.userId} = ${agent.id} and ${devicePairingCodes.usedAt} is null`)).length).toBe(1);
    });

    it("the token identifies the phone; a revoked phone and a suspended person stop working at once", async () => {
      const d = (await pair("auth"))!;
      const session = await authenticateDevice(app.db, d.token);
      expect(session?.actor.id).toBe(agent.id);
      expect(await authenticateDevice(app.db, `${d.token}x`)).toBeNull();
      expect(await authenticateDevice(app.db, "vd_short")).toBeNull();
      await revokeDevice(app.db, { ...agent, permissions: [...agent.permissions, "devices.revoke.all"] }, d.deviceId);
      expect(await authenticateDevice(app.db, d.token)).toBeNull();
      const again = (await pair("auth"))!; // pairing the same phone again with a fresh code brings it back, as the same device
      expect(again.deviceId).toBe(d.deviceId);
      expect(await authenticateDevice(app.db, again.token)).not.toBeNull();
      expect(await authenticateDevice(app.db, d.token)).toBeNull(); // the old token is gone
      await owner.db.update(users).set({ status: "suspended" }).where(sql`${users.id} = ${agent.id}`);
      expect(await authenticateDevice(app.db, again.token)).toBeNull();
      await owner.db.update(users).set({ status: "active" }).where(sql`${users.id} = ${agent.id}`);
    });

    it("syncs calls safely: a repeat saves nothing twice, unknown numbers become leads, bad ones are acknowledged and refused", async () => {
      const session = (await authenticateDevice(app.db, (await pair("sync"))!.token))!;
      const base = { direction: "outbound" as const, status: "connected" as const, durationS: 61 };
      const batch = [
        { ...base, localId: "c1", number: "+91 98000 00001", startedAt: "2026-10-26T04:30:00Z" },
        { ...base, localId: "c2", number: "9811122233", startedAt: "2026-10-26T05:00:00+05:30", direction: "inbound" as const, status: "missed" as const, durationS: 0 },
        { ...base, localId: "c3", number: "12", startedAt: "2026-10-26T04:30:00Z" },
        { ...base, localId: "c4", number: "+919800000001", startedAt: "2099-01-01T00:00:00Z" },
      ];
      const first = await syncDeviceCalls(app.db, session, batch);
      expect(first.map((o) => `${o.localId}:${o.result}${o.reason ? `(${o.reason})` : ""}`)).toEqual(["c1:saved", "c2:saved", "c3:rejected(invalid_number)", "c4:rejected(from_the_future)"]);
      const again = await syncDeviceCalls(app.db, session, batch);
      expect(again.map((o) => o.result)).toEqual(["duplicate", "duplicate", "rejected", "rejected"]);
      const logs = await owner.db.select().from(callLogs).where(sql`${callLogs.deviceId} = ${session.deviceId}`);
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.source === "mobile_sim" && l.agentUserId === agent.id)).toBe(true);
      expect(logs.find((l) => l.status === "missed")?.direction).toBe("inbound");
      const [made] = await owner.db.select().from(leads).where(sql`${leads.phoneE164} = '+919811122233' and ${leads.orgId} = ${ids.o1}`);
      expect(made).toMatchObject({ source: "mobile_sim", consentStatus: "unknown", ownerUserId: agent.id });
      const [dev] = await owner.db.select().from(devices).where(sql`${devices.id} = ${session.deviceId}`);
      expect(dev!.lastSyncAt).not.toBeNull();
    });

    it("two phones can use the same local call id without clashing", async () => {
      const a = (await authenticateDevice(app.db, (await pair("p1"))!.token))!, b = (await authenticateDevice(app.db, (await pair("p2"))!.token))!;
      const call = { localId: "same", number: "+919800000002", direction: "outbound" as const, status: "connected" as const, startedAt: "2026-10-26T04:30:00Z", durationS: 5 };
      expect((await syncDeviceCalls(app.db, a, [call]))[0]!.result).toBe("saved");
      expect((await syncDeviceCalls(app.db, b, [call]))[0]!.result).toBe("saved");
    });

    it("checks a number before dialling: DND, consent and hours for leads, only hours for unknown numbers", async () => {
      const noon = new Date("2026-10-26T06:30:00Z"), night = new Date("2026-10-26T20:30:00Z"); // 12:00 and 02:00 India time
      await owner.db.update(leads).set({ dndFlag: true }).where(sql`${leads.phoneE164} = '+919800000001' and ${leads.orgId} = ${ids.o1}`);
      expect(await checkOutboundNumber(app.db, agent, "98000 00001", noon)).toEqual({ allowed: false, reason: "dnd" });
      expect(await checkOutboundNumber(app.db, agent, "+919800000002", noon)).toEqual({ allowed: true });
      expect(await checkOutboundNumber(app.db, agent, "+917777700000", noon)).toEqual({ allowed: true });
      expect(await checkOutboundNumber(app.db, agent, "+917777700000", night)).toEqual({ allowed: false, reason: "outside_hours" });
      expect(await checkOutboundNumber(app.db, agent, "12", noon)).toEqual({ allowed: false, reason: "invalid_number" });
      await owner.db.update(leads).set({ dndFlag: false }).where(sql`${leads.phoneE164} = '+919800000001' and ${leads.orgId} = ${ids.o1}`);
    });

    it("logs a call made from the web dialer against the lead, creating the lead if it is new", async () => {
      const startedAt = new Date("2026-10-26T05:00:00Z");
      const first = await logDialerCall(app.db, agent, { number: "+91 91111 22222", status: "connected", durationS: 125.4, startedAt });
      const second = await logDialerCall(app.db, agent, { number: "9111122222", status: "missed", durationS: 0, startedAt });
      expect(first?.leadId).toBe(second?.leadId); // the same person, however the number was typed
      const rows = await owner.db.select().from(callLogs).where(sql`${callLogs.leadId} = ${first!.leadId}`);
      expect(rows.map((r) => `${r.source}/${r.direction}/${r.status}/${r.durationS}`).sort()).toEqual(["web_dialer/outbound/connected/125", "web_dialer/outbound/missed/0"]);
      expect(rows.every((r) => r.agentUserId === agent.id)).toBe(true);
      expect(await logDialerCall(app.db, agent, { number: "12", status: "connected", durationS: 1, startedAt })).toBeNull();
      await expect(logDialerCall(app.db, user("viewer", "v", []), { number: "9111122222", status: "connected", durationS: 1, startedAt })).rejects.toThrow(/Forbidden/);
    });

    it("attaches a recording only to the phone's own call, and only once", async () => {
      const a = (await authenticateDevice(app.db, (await pair("rec1"))!.token))!, b = (await authenticateDevice(app.db, (await pair("rec2"))!.token))!;
      await syncDeviceCalls(app.db, a, [{ localId: "r1", number: "+919800000002", direction: "outbound", status: "connected", startedAt: "2026-10-26T04:30:00Z", durationS: 30 }]);
      expect(await findDeviceCall(app.db, b, "r1")).toBeNull(); // another phone cannot touch it
      expect(await findDeviceCall(app.db, a, "nope")).toBeNull();
      const call = (await findDeviceCall(app.db, a, "r1"))!;
      expect(call.hasRecording).toBe(false);
      expect(await setRecordingKey(app.db, b, call.id, "rec/x.m4a")).toBe(false);
      expect(await setRecordingKey(app.db, a, call.id, "rec/first.m4a")).toBe(true);
      expect(await setRecordingKey(app.db, a, call.id, "rec/second.m4a")).toBe(false); // never replaced
      expect((await findDeviceCall(app.db, a, "r1"))!.hasRecording).toBe(true);
      const [row] = await owner.db.select().from(callLogs).where(sql`${callLogs.id} = ${call.id}`);
      expect(row!.recordingKey).toBe("rec/first.m4a");
    });

    it("'stop and delete' removes the phone's calls and only the leads it created, and locks the phone out", async () => {
      const session = (await authenticateDevice(app.db, (await pair("forget"))!.token))!;
      const token = (await pair("forget"))!.token; // pairing again returns the same device with a fresh token
      const [before] = await owner.db.select().from(leads).where(sql`${leads.phoneE164} = '+919800000002' and ${leads.orgId} = ${ids.o1}`); // a lead that already existed
      await syncDeviceCalls(app.db, session, [
        { localId: "f1", number: "+919800000002", direction: "outbound", status: "connected", startedAt: "2026-10-26T04:30:00Z", durationS: 10 },
        { localId: "f2", number: "+918800099999", direction: "inbound", status: "missed", startedAt: "2026-10-26T05:30:00Z", durationS: 0 },
      ]);
      const fresh = (await authenticateDevice(app.db, token))!;
      const call = (await findDeviceCall(app.db, fresh, "f1"))!;
      await setRecordingKey(app.db, fresh, call.id, "rec/to-delete.m4a");
      expect(await owner.db.select().from(leads).where(sql`${leads.phoneE164} = '+918800099999'`)).toHaveLength(1);
      const out = await forgetDevice(app.db, fresh);
      expect(out).toEqual({ calls: 2, leads: 1, recordingKeys: ["rec/to-delete.m4a"] });
      expect(await owner.db.select().from(callLogs).where(sql`${callLogs.deviceId} = ${fresh.deviceId}`)).toHaveLength(0);
      expect(await owner.db.select().from(leads).where(sql`${leads.phoneE164} = '+918800099999'`)).toHaveLength(0); // created by this phone: gone
      const [after] = await owner.db.select().from(leads).where(sql`${leads.id} = ${before!.id}`);
      expect(after).toBeTruthy(); // the lead that already existed stays
      expect(await authenticateDevice(app.db, token)).toBeNull();
      expect(await owner.db.select().from(devices).where(sql`${devices.id} = ${fresh.deviceId}`)).toHaveLength(0);
      const [audit] = await owner.db.select().from(auditLogs).where(sql`${auditLogs.action} = 'device.forget' and ${auditLogs.entityId} = ${fresh.deviceId}`);
      expect(audit!.after).toEqual({ calls: 2, leads: 1 }); // counts only, never numbers
    });

    it("never leaks another organisation's phone: a token only reaches its own org", async () => {
      const session = (await authenticateDevice(app.db, (await pair("iso"))!.token))!;
      await syncDeviceCalls(app.db, session, [{ localId: "iso1", number: "+919800000003", direction: "outbound", status: "connected", startedAt: "2026-10-26T04:30:00Z", durationS: 5 }]);
      const other = await owner.db.select().from(leads).where(sql`${leads.orgId} = ${ids.o2}`);
      expect(other).toHaveLength(1); // org 2 still has only its own lead; the same number in org 1 became a separate lead
      const mine = await owner.db.select().from(leads).where(sql`${leads.phoneE164} = '+919800000003' and ${leads.orgId} = ${ids.o1}`);
      expect(mine).toHaveLength(1);
    });
  });

  describe("post-call analysis (Phase 4)", () => {
    type Status = "new" | "contacted" | "interested" | "callback_requested" | "not_interested" | "won" | "lost";
    let n = 0;
    const analysis = (o: Partial<Parameters<typeof saveAnalysis>[2]> = {}): Parameters<typeof saveAnalysis>[2] => ({ summary: "Caller asked about price.", intent: "pricing_inquiry", sentimentScore: 0.4, sentimentLabel: "positive", nextAction: "Send the plan details", suggestedStatus: "interested", confidence: 0.9, doNotCall: false, ...o });
    const mkCall = async (status: Status = "new", ageMs = 60_000, withTranscript = true) => {
      const [lead] = await owner.db.insert(leads).values({ orgId: ids.o1!, teamId: ids.tA!, ownerUserId: ids.mgr!, phoneE164: `+9177${String(++n).padStart(8, "0")}`, status }).returning();
      const [call] = await owner.db.insert(callLogs).values({ orgId: ids.o1!, teamId: ids.tA!, leadId: lead!.id, direction: "inbound", source: "ai_inbound", status: "connected", startedAt: new Date(), durationS: 30, createdAt: new Date(Date.now() - ageMs) }).returning();
      if (withTranscript) await owner.db.insert(callTranscripts).values({ callLogId: call!.id, orgId: ids.o1!, teamId: ids.tA!, segments: [{ speaker: "caller", startMs: 0, endMs: 1000, text: "hello" }], language: "en" });
      return { lead: lead!, call: call!, p: { callLogId: call!.id, orgId: ids.o1! } };
    };
    const leadNow = async (id: string) => (await owner.db.select().from(leads).where(sql`${leads.id} = ${id}`))[0]!;

    it("finds finished calls with a transcript and no insights, and nothing else", async () => {
      const ready = await mkCall(), tooNew = await mkCall("new", 1000), noTranscript = await mkCall("new", 60_000, false), done = await mkCall();
      await saveAnalysis(app.db, done.p, analysis(), "test");
      const ids_ = (await listPendingAnalysis(app.db, 50)).map((x) => x.callLogId);
      expect(ids_).toContain(ready.call.id);
      expect(ids_).not.toContain(tooNew.call.id);
      expect(ids_).not.toContain(noTranscript.call.id);
      expect(ids_).not.toContain(done.call.id);
    });

    it("applies a confident status change, with history and audit, and a repeat changes nothing", async () => {
      const { lead, call, p } = await mkCall("new");
      expect(await saveAnalysis(app.db, p, analysis({ suggestedStatus: "interested", confidence: 0.9 }), "test")).toEqual({ saved: true, status: "applied", dndSet: false });
      expect((await leadNow(lead.id)).status).toBe("interested");
      const [h] = await owner.db.select().from(leadStatusHistory).where(sql`${leadStatusHistory.leadId} = ${lead.id}`);
      expect(h).toMatchObject({ fromStatus: "new", toStatus: "interested", changedBy: "ai", confidence: 0.9, callLogId: call.id });
      const [a] = await owner.db.select().from(auditLogs).where(sql`${auditLogs.action} = 'lead.status_auto' and ${auditLogs.entityId} = ${lead.id}`);
      expect(a!.actorUserId).toBeNull();
      expect(await saveAnalysis(app.db, p, analysis({ suggestedStatus: "not_interested", confidence: 1 }), "test")).toEqual({ saved: false, status: "none", dndSet: false });
      expect((await leadNow(lead.id)).status).toBe("interested");
      expect(await owner.db.select().from(leadStatusHistory).where(sql`${leadStatusHistory.leadId} = ${lead.id}`)).toHaveLength(1);
      expect(await listPendingAnalysis(app.db, 50).then((r) => r.some((x) => x.callLogId === call.id))).toBe(false);
    });

    it("leaves a hesitant suggestion for the owner, and never closes a lead or reopens a closed one", async () => {
      const low = await mkCall("new");
      expect((await saveAnalysis(app.db, low.p, analysis({ confidence: 0.79 }), "t")).status).toBe("queued");
      expect((await leadNow(low.lead.id)).status).toBe("new");
      const close = await mkCall("interested");
      expect((await saveAnalysis(app.db, close.p, analysis({ suggestedStatus: "won", confidence: 1 }), "t")).status).toBe("queued");
      expect((await leadNow(close.lead.id)).status).toBe("interested");
      const closed = await mkCall("won");
      expect((await saveAnalysis(app.db, closed.p, analysis({ suggestedStatus: "interested", confidence: 1 }), "t")).status).toBe("queued");
      expect((await leadNow(closed.lead.id)).status).toBe("won");
      expect((await owner.db.select().from(callInsights).where(sql`${callInsights.callLogId} = ${low.call.id}`))[0]).toMatchObject({ suggestedStatus: "interested", suggestedStatusConfidence: 0.79 });
    });

    it("switches Do Not Disturb on when the caller asks not to be called, and never switches it off", async () => {
      const a = await mkCall("new");
      expect((await saveAnalysis(app.db, a.p, analysis({ suggestedStatus: "not_interested", confidence: 0.95, doNotCall: true }), "t")).dndSet).toBe(true);
      expect(await leadNow(a.lead.id)).toMatchObject({ dndFlag: true, status: "not_interested" });
      expect(await owner.db.select().from(auditLogs).where(sql`${auditLogs.action} = 'lead.dnd_auto_set' and ${auditLogs.entityId} = ${a.lead.id}`)).toHaveLength(1);
      const b = await mkCall("new");
      await owner.db.update(leads).set({ dndFlag: true }).where(sql`${leads.id} = ${b.lead.id}`);
      expect((await saveAnalysis(app.db, b.p, analysis({ doNotCall: false }), "t")).dndSet).toBe(false);
      expect((await leadNow(b.lead.id)).dndFlag).toBe(true);
    });

    it("retries a failed call later with growing pauses, and stops after five failures", async () => {
      const { call, p } = await mkCall();
      const now = new Date();
      await recordAnalysisFailure(app.db, p, "model down", now);
      const pending = async () => (await listPendingAnalysis(app.db, 50)).some((x) => x.callLogId === call.id);
      expect(await pending()).toBe(false); // waiting a minute
      let [row] = await owner.db.select().from(callAnalysisAttempts).where(sql`${callAnalysisAttempts.callLogId} = ${call.id}`);
      expect(row).toMatchObject({ attempts: 1, lastError: "model down" });
      expect(Math.round((row!.nextTryAt.getTime() - now.getTime()) / 60_000)).toBe(1);
      await owner.db.update(callAnalysisAttempts).set({ nextTryAt: new Date(Date.now() - 1000) }).where(sql`${callAnalysisAttempts.callLogId} = ${call.id}`);
      expect(await pending()).toBe(true);
      await recordAnalysisFailure(app.db, p, "again", now);
      [row] = await owner.db.select().from(callAnalysisAttempts).where(sql`${callAnalysisAttempts.callLogId} = ${call.id}`);
      expect(Math.round((row!.nextTryAt.getTime() - now.getTime()) / 60_000)).toBe(2);
      for (let i = 0; i < 3; i++) await recordAnalysisFailure(app.db, p, "again", new Date(Date.now() - 3_600_000 * 24));
      await owner.db.update(callAnalysisAttempts).set({ nextTryAt: new Date(Date.now() - 1000) }).where(sql`${callAnalysisAttempts.callLogId} = ${call.id}`);
      expect(await pending()).toBe(false); // five failed tries: left alone
    });

    it("re-runs an analysis on request: the new answer replaces the old and changes nothing about the lead", async () => {
      const { lead, call, p } = await mkCall("new");
      await saveAnalysis(app.db, p, analysis({ suggestedStatus: "interested", confidence: 0.9 }), "first");
      expect((await leadNow(lead.id)).status).toBe("interested");
      await expect(requeueAnalysis(app.db, user("viewer", "v", []), call.id)).rejects.toThrow(/Forbidden/);
      expect(await requeueAnalysis(app.db, user("manager", ids.mgr!, [ids.tA!]), call.id)).toBe("queued");
      expect(await requeueAnalysis(app.db, user("manager", ids.mgr!, [ids.tA!]), "00000000-0000-4000-8000-000000000000")).toBe("not_found");
      expect((await listPendingAnalysis(app.db, 50)).some((x) => x.callLogId === call.id)).toBe(true);
      const r = await saveAnalysis(app.db, p, analysis({ summary: "A fresh summary.", suggestedStatus: "not_interested", confidence: 0.95, doNotCall: true }), "second");
      expect(r).toEqual({ saved: true, status: "none", dndSet: false, rerun: true });
      expect(await leadNow(lead.id)).toMatchObject({ status: "interested", dndFlag: false }); // nothing about the lead changed
      expect((await owner.db.select().from(callInsights).where(sql`${callInsights.callLogId} = ${call.id}`))[0]).toMatchObject({ summary: "A fresh summary.", suggestedStatus: "not_interested", modelVersion: "second" });
      expect(await owner.db.select().from(callAnalysisAttempts).where(sql`${callAnalysisAttempts.callLogId} = ${call.id}`)).toHaveLength(0);
      expect((await listPendingAnalysis(app.db, 50)).some((x) => x.callLogId === call.id)).toBe(false);
      expect(await owner.db.select().from(leadStatusHistory).where(sql`${leadStatusHistory.leadId} = ${lead.id}`)).toHaveLength(1); // only the first analysis changed the status
    });

    it("lists the calls the AI gave up on, and a re-run brings one back", async () => {
      const { call, p } = await mkCall();
      const manager = user("manager", ids.mgr!, [ids.tA!]);
      const before = await countFailedAnalyses(app.db, manager);
      for (let i = 0; i < 5; i++) await recordAnalysisFailure(app.db, p, "the model is down", new Date(Date.now() - 86_400_000));
      expect(await countFailedAnalyses(app.db, manager)).toBe(before + 1);
      const failed = await listCalls(app.db, manager, { analysis: "failed" });
      expect(failed.rows.some((r) => r.id === call.id)).toBe(true);
      expect(failed.rows.every((r) => r.id !== undefined)).toBe(true);
      expect((await listPendingAnalysis(app.db, 50)).some((x) => x.callLogId === call.id)).toBe(false);
      expect(await requeueAnalysis(app.db, manager, call.id)).toBe("queued");
      expect(await countFailedAnalyses(app.db, manager)).toBe(before);
      expect((await listPendingAnalysis(app.db, 50)).some((x) => x.callLogId === call.id)).toBe(true);
      // a first analysis that failed, re-run, is analysed like a new one: the rules apply
      expect((await saveAnalysis(app.db, p, analysis({ suggestedStatus: "interested", confidence: 0.9 }), "t")).status).toBe("applied");
    });

    it("purges recordings and transcripts after their organisation's retention period, and keeps the call itself", async () => {
      const [org] = await owner.db.select().from(organizations).where(sql`${organizations.id} = ${ids.o1}`);
      const old = async (daysAgo: number, key?: string) => {
        const { call, p } = await mkCall();
        await owner.db.update(callLogs).set({ startedAt: new Date(Date.now() - daysAgo * 86_400_000), recordingKey: key ?? null }).where(sql`${callLogs.id} = ${call.id}`);
        await saveAnalysis(app.db, p, analysis(), "t");
        return { call, p };
      };
      const expired = await old(org!.dataRetentionDays + 5, "rec/old.m4a");
      const recent = await old(5, "rec/recent.m4a");
      const midLife = await old(org!.recordingRetentionDays + 5, "rec/mid.m4a"); // recording expired, transcript not yet
      const recs = await listExpiredRecordings(app.db, 500);
      expect(recs.some((r) => r.callLogId === expired.call.id && r.recordingKey === "rec/old.m4a")).toBe(true);
      expect(recs.some((r) => r.callLogId === midLife.call.id)).toBe(true);
      expect(recs.some((r) => r.callLogId === recent.call.id)).toBe(false);
      const texts = await listExpiredTranscripts(app.db, 500);
      expect(texts.some((r) => r.callLogId === expired.call.id)).toBe(true);
      expect(texts.some((r) => r.callLogId === midLife.call.id)).toBe(false);
      expect(texts.some((r) => r.callLogId === recent.call.id)).toBe(false);
      expect(await purgeRecording(app.db, recs.find((r) => r.callLogId === expired.call.id)!)).toBe(true);
      expect(await purgeRecording(app.db, recs.find((r) => r.callLogId === expired.call.id)!)).toBe(false); // already gone
      expect(await purgeTranscript(app.db, texts.find((r) => r.callLogId === expired.call.id)!)).toBe(true);
      const [kept] = await owner.db.select().from(callLogs).where(sql`${callLogs.id} = ${expired.call.id}`);
      expect(kept).toMatchObject({ recordingKey: null, durationS: 30 }); // the call stays, the recording is gone
      expect(await owner.db.select().from(callTranscripts).where(sql`${callTranscripts.callLogId} = ${expired.call.id}`)).toHaveLength(0);
      expect(await owner.db.select().from(callInsights).where(sql`${callInsights.callLogId} = ${expired.call.id}`)).toHaveLength(0);
      const audit = await owner.db.select().from(auditLogs).where(sql`${auditLogs.entityId} = ${expired.call.id} and ${auditLogs.action} in ('recording.purged','transcript.purged')`);
      expect(audit.map((a) => a.action).sort()).toEqual(["recording.purged", "transcript.purged"]);
      expect(JSON.stringify(audit)).not.toMatch(/hello|Caller asked/); // no content in the audit trail
      expect((await owner.db.select().from(callLogs).where(sql`${callLogs.id} = ${recent.call.id}`))[0]!.recordingKey).toBe("rec/recent.m4a");
    });

    it("lets the owner confirm a queued suggestion, but nobody outside their reach", async () => {
      const { lead, call, p } = await mkCall("new");
      await saveAnalysis(app.db, p, analysis({ suggestedStatus: "callback_requested", confidence: 0.6 }), "t");
      const other = { ...user("manager", "other-manager", [ids.tB!]) };
      await expect(applySuggestedStatus(app.db, other, call.id)).rejects.toThrow(/Forbidden/);
      await expect(applySuggestedStatus(app.db, user("viewer", "v", []), call.id)).rejects.toThrow(/Forbidden/);
      expect(await applySuggestedStatus(app.db, user("manager", ids.mgr!, [ids.tA!]), call.id)).toBe("applied");
      expect((await leadNow(lead.id)).status).toBe("callback_requested");
      expect((await owner.db.select().from(leadStatusHistory).where(sql`${leadStatusHistory.leadId} = ${lead.id}`))[0]).toMatchObject({ changedBy: "user", changedByUserId: ids.mgr });
      expect(await applySuggestedStatus(app.db, user("manager", ids.mgr!, [ids.tA!]), call.id)).toBe("nothing_to_apply");
      expect(await applySuggestedStatus(app.db, user("manager", ids.mgr!, [ids.tA!]), "00000000-0000-4000-8000-000000000000")).toBe("not_found");
    });
  });
});
