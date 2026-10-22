import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, type AuthUser } from "@voiceai/auth";
import { createDb, withOrg } from "./client";
import { consentRecords, leads, organizations, teams, users } from "./schema";
import { scopedRepos } from "./scoped";
import { createVoiceProfile, listSelectableVoices, resolveCallVoice, revokeVoiceProfile } from "./voice-profiles";

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
});
