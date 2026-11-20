import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@voiceai/auth";
import { and, eq } from "drizzle-orm";
import { createDb } from "./client";
import { AdminError } from "./platform-admin";
import { MAX_TRUNKS_PER_ORG, assertTrunkRoom, commitNumberTrunk, deleteTrunkRecord, getMyTrunk, listMyTrunks, recordTrunk, saveTrunkHealth, setNumberTrunk } from "./sip-trunks";
import { auditLogs, organizations, phoneNumbers, users } from "./schema";

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("SIP trunks are private to their organisation", () => {
  const owner = createDb(ownerUrl ?? ""), app = createDb(appUrl ?? "");
  const tag = randomUUID().slice(0, 8);
  let a = "", b = "", ua = "", ub = "", numTwilio = "", numPlivo = "";
  const user = (orgId: string, perms: string[]) => ({ id: orgId === a ? ua : ub, orgId, permissions: perms, teamIds: [], role: "org_admin" }) as unknown as AuthUser;
  const adminA = () => user(a, ["org_settings.read", "org_settings.write"]), adminB = () => user(b, ["org_settings.read", "org_settings.write"]);
  const digits = (n: number) => String(parseInt(tag, 16) % 10 ** 7).padStart(7, "0") + n;

  beforeAll(async () => {
    const orgs = await owner.db.insert(organizations).values([{ name: `TrA-${tag}` }, { name: `TrB-${tag}` }]).returning();
    a = orgs[0]!.id; b = orgs[1]!.id;
    const us = await owner.db.insert(users).values([{ orgId: a, email: `tr-a-${tag}@test.invalid`, passwordHash: "x" }, { orgId: b, email: `tr-b-${tag}@test.invalid`, passwordHash: "x" }]).returning();
    ua = us[0]!.id; ub = us[1]!.id;
    const nums = await owner.db.insert(phoneNumbers).values([
      { e164: `+1415${digits(1)}`.slice(0, 15), orgId: a, status: "assigned", carrier: "twilio" },
      { e164: `+1650${digits(2)}`.slice(0, 15), orgId: a, status: "assigned", carrier: "plivo" },
    ]).returning();
    numTwilio = nums[0]!.id; numPlivo = nums[1]!.id;
  });
  afterAll(async () => { await owner.pool.end(); await app.pool.end(); });

  it("records a trunk with an audit row, and the other organisation cannot see or touch it", async () => {
    const t = await recordTrunk(app.db, adminA(), { name: "PBX", providerTrunkSid: `TK${tag}`, terminationDomain: `x${tag}.pstn.twilio.com`, originationUrls: ["sip:pbx.example.com"] });
    expect((await listMyTrunks(app.db, adminA())).trunks.map((x) => x.id)).toContain(t.id);
    expect((await listMyTrunks(app.db, adminB())).trunks).toHaveLength(0);
    await expect(getMyTrunk(app.db, adminB(), t.id)).rejects.toThrow(AdminError);
    await expect(deleteTrunkRecord(app.db, adminB(), t.id)).rejects.toThrow(AdminError);
    expect((await owner.db.select().from(auditLogs).where(and(eq(auditLogs.orgId, a), eq(auditLogs.entityId, t.id)))).map((r) => r.action)).toEqual(["sip_trunk.create"]);
  });
  it("needs the permission, stores health, and links only Twilio numbers of the organisation", async () => {
    await expect(recordTrunk(app.db, user(a, ["org_settings.read"]), { name: "x", providerTrunkSid: `TKn${tag}`, terminationDomain: null, originationUrls: [] })).rejects.toThrow();
    const [t] = (await listMyTrunks(app.db, adminA())).trunks;
    await saveTrunkHealth(app.db, adminA(), t!.id, { status: "degraded", checks: [{ name: "numbers", status: "degraded", detail: "none" }], checkedAt: new Date().toISOString() });
    expect((await getMyTrunk(app.db, adminA(), t!.id)).lastHealthStatus).toBe("degraded");
    await expect(setNumberTrunk(app.db, adminA(), numPlivo, t!.id)).rejects.toThrow(/Twilio numbers only/);
    await expect(setNumberTrunk(app.db, adminB(), numTwilio, t!.id)).rejects.toThrow(/not assigned/);
    const r = await setNumberTrunk(app.db, adminA(), numTwilio, t!.id);
    expect(r.trunk?.providerTrunkSid).toBe(`TK${tag}`);
    await commitNumberTrunk(app.db, adminA(), numTwilio, t!.id);
    expect((await listMyTrunks(app.db, adminA())).numbers.find((n) => n.id === numTwilio)?.trunkId).toBe(t!.id);
  });
  it("stops at the trunk limit and deleting a trunk frees its numbers", async () => {
    const have = (await listMyTrunks(app.db, adminA())).trunks.length;
    for (let i = 0; i < MAX_TRUNKS_PER_ORG - have; i++) await recordTrunk(app.db, adminA(), { name: `T${i}`, providerTrunkSid: `TKx${i}${tag}`, terminationDomain: null, originationUrls: [] });
    await expect(assertTrunkRoom(app.db, adminA())).rejects.toThrow(/up to 5/);
    const t = (await listMyTrunks(app.db, adminA())).trunks.find((x) => x.name === "PBX")!;
    await deleteTrunkRecord(app.db, adminA(), t.id);
    expect((await listMyTrunks(app.db, adminA())).numbers.find((n) => n.id === numTwilio)?.trunkId).toBeNull();
  });
});
