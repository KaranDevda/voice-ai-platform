import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, ROLE_PERMISSIONS, type AuthUser, type RoleKey } from "@voiceai/auth";
import { createDb } from "./client";
import { getAgentConfig } from "./queries";
import { deleteAsset, deleteKnowledgeDoc, getAsset, getAssetAudio, ingestKnowledge, listAssets, listUsage, logUsage, saveAsset, searchKnowledge, usageToday } from "./studio";
import { assertConsentUsable } from "./voice-profiles";
import { EMBEDDING_DIMENSIONS, consentRecords, organizations, users, voiceProfiles } from "./schema";

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("studio data layer", () => {
  const owner = createDb(ownerUrl ?? "");
  const app = createDb(appUrl ?? "");
  const x = {} as Record<string, string>;
  const tag = randomUUID().slice(0, 8);
  const as = (role: RoleKey, id: string, orgId = x.org!): AuthUser => ({ id, orgId, teamIds: [], permissions: ROLE_PERMISSIONS[role] });

  beforeAll(async () => {
    const [o1, o2] = await owner.db.insert(organizations).values([{ name: `S1-${tag}` }, { name: `S2-${tag}` }]).returning();
    const mk = (email: string, org: string) => ({ orgId: org, email: `${email}-${tag}@x.io`, passwordHash: "x" });
    const [admin, m1, m2, other] = await owner.db.insert(users).values([mk("admin", o1!.id), mk("m1", o1!.id), mk("m2", o1!.id), mk("o", o2!.id)]).returning();
    Object.assign(x, { org: o1!.id, org2: o2!.id, admin: admin!.id, m1: m1!.id, m2: m2!.id, other: other!.id });
  });
  afterAll(async () => { await owner.pool.end(); await app.pool.end(); });

  const speech = (title: string, audio?: Uint8Array) => ({ kind: "speech" as const, title, text: `${title} script`, provider: "deepgram", voiceRef: "dg:aura-2-thalia-en", mime: "audio/mpeg", audio });

  it("scopes projects: managers see only their own, admins see all, other orgs see nothing", async () => {
    await saveAsset(app.db, as("manager", x.m1!), speech("M1 clip", new Uint8Array([1, 2, 3])));
    await saveAsset(app.db, as("manager", x.m2!), speech("M2 clip"));
    const titles = async (u: AuthUser) => (await listAssets(app.db, u)).rows.map((r) => r.title).sort();
    expect(await titles(as("manager", x.m1!))).toEqual(["M1 clip"]);
    expect(await titles(as("org_admin", x.admin!))).toEqual(["M1 clip", "M2 clip"]);
    expect(await titles(as("org_admin", x.other!, x.org2!))).toEqual([]);
    await expect(saveAsset(app.db, as("agent", "a"), speech("nope"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAssets(app.db, as("agent", "a"))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("serves audio only to those in scope and never lists raw bytes", async () => {
    const m1 = as("manager", x.m1!);
    const [row] = (await listAssets(app.db, m1)).rows;
    expect(row).not.toHaveProperty("audio");
    expect(row!.hasAudio).toBe(true);
    expect([...(await getAssetAudio(app.db, m1, row!.id))!.audio]).toEqual([1, 2, 3]);
    expect(await getAssetAudio(app.db, as("manager", x.m2!), row!.id)).toBeNull();
    expect(await getAsset(app.db, as("manager", x.m2!), row!.id)).toBeNull();
    expect(await getAssetAudio(app.db, as("org_admin", x.other!, x.org2!), row!.id)).toBeNull();
  });

  it("lets owners and admins delete (audited); others see it as missing", async () => {
    const [m2clip] = (await listAssets(app.db, as("manager", x.m2!))).rows;
    expect(await deleteAsset(app.db, as("manager", x.m1!), m2clip!.id)).toBe(false); // not theirs: looks like missing
    expect(await deleteAsset(app.db, as("manager", x.m2!), m2clip!.id)).toBe(true);
    expect(await deleteAsset(app.db, as("manager", x.m2!), m2clip!.id)).toBe(false);
    const audit = await owner.db.execute(`select count(*)::int as n from audit_logs where action = 'project.delete' and org_id = '${x.org}'` as never);
    expect((audit.rows[0] as { n: number }).n).toBe(1);
  });

  it("records provider usage and shows it only to those with logs.read", async () => {
    await logUsage(app.db, { orgId: x.org!, userId: x.admin, provider: "deepgram", operation: "speech", status: "ok", latencyMs: 812, units: 120 });
    await logUsage(app.db, { orgId: x.org!, userId: x.admin, provider: "deepgram", operation: "speech", status: "error", latencyMs: 40, error: "boom" });
    const u = await listUsage(app.db, as("org_admin", x.admin!));
    expect(u.rows.length).toBeGreaterThanOrEqual(2);
    const s = u.summary.find((r) => r.provider === "deepgram" && r.operation === "speech")!;
    expect(s).toMatchObject({ calls: 2, errors: 1, units: 120 });
    await expect(listUsage(app.db, as("manager", x.m1!))).rejects.toBeInstanceOf(ForbiddenError);
    expect((await usageToday(app.db, as("manager", x.m1!))).calls).toBe(2);
    expect((await listUsage(app.db, as("org_admin", x.other!, x.org2!))).rows).toEqual([]);
    // A broken usage write must never throw into a user's request.
    await expect(logUsage(app.db, { orgId: "not-a-uuid", provider: "p", operation: "o", status: "ok", latencyMs: 1 })).resolves.toBeUndefined();
  });

  it("ingests and retrieves knowledge by keyword, per org, admins only", async () => {
    const admin = as("org_admin", x.admin!);
    const text = "The Business plan costs 4,999 rupees per month.\n\nRecordings are kept for 180 days in India.\n\nSupport is available on weekdays.";
    await expect(ingestKnowledge(app.db, as("manager", x.m1!), { title: "x", text })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(ingestKnowledge(app.db, admin, { title: " ", text })).rejects.toBeInstanceOf(RangeError);
    const doc = await ingestKnowledge(app.db, admin, { title: "FAQ", text });
    expect(doc.chunks).toBe(1);
    const hit = await searchKnowledge(app.db, admin, "How long are recordings kept?");
    expect(hit[0]).toMatchObject({ title: "FAQ" });
    expect(hit[0]!.content).toContain("180 days");
    expect(await searchKnowledge(app.db, admin, "zzzzqqq nothing")).toEqual([]);
    // A strong match hides chunks that only share one incidental word.
    const other = await ingestKnowledge(app.db, admin, { title: "Support", text: "Support is available on weekdays from nine to six." });
    const ranked = await searchKnowledge(app.db, admin, "business plan costs rupees per month");
    expect(ranked.map((r) => r.title)).toEqual(["FAQ"]);
    await deleteKnowledgeDoc(app.db, admin, other.id);
    expect(await searchKnowledge(app.db, admin, "a of to")).toEqual([]);
    expect(await searchKnowledge(app.db, as("org_admin", x.other!, x.org2!), "recordings")).toEqual([]);
    expect(await searchKnowledge(app.db, as("manager", x.m1!), "recordings")).toHaveLength(1);
    await expect(searchKnowledge(app.db, as("agent", "a"), "recordings")).rejects.toBeInstanceOf(ForbiddenError);
    // LIKE wildcards in a query are literal text, not patterns.
    expect(await searchKnowledge(app.db, admin, "100%_wild")).toEqual([]);
    expect(await deleteKnowledgeDoc(app.db, admin, doc.id)).toBe(true);
    expect(await searchKnowledge(app.db, admin, "recordings")).toEqual([]);
  });

  it("retrieves multilingual knowledge by cosine similarity when embeddings exist", async () => {
    const admin = as("org_admin", x.admin!);
    const related = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i === 0 ? 1 : 0);
    const unrelated = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => i === 1 ? 1 : 0);
    await ingestKnowledge(app.db, admin, { title: "Semantic FAQ", text: "Our callback service is available every day." }, [related]);
    await ingestKnowledge(app.db, admin, { title: "Other FAQ", text: "The office is closed on Sundays." }, [unrelated]);
    const hits = await searchKnowledge(app.db, admin, "मुझे सहायता चाहिए", 2, related);
    expect(hits.map((hit) => hit.title)).toEqual(["Semantic FAQ"]);
  });

  it("refuses to clone without a valid, unused consent for that donor", async () => {
    const admin = as("org_admin", x.admin!);
    const [c] = await owner.db.insert(consentRecords).values({ orgId: x.org!, subjectType: "staff", subjectId: x.m1!, purpose: "ai", method: "written_signed", documentUrl: "s3://c", grantedAt: new Date() }).returning();
    await expect(assertConsentUsable(app.db, admin, x.m1!, c!.id)).resolves.toBeUndefined();
    await expect(assertConsentUsable(app.db, admin, x.m2!, c!.id)).rejects.toThrow(/does not belong/);
    await expect(assertConsentUsable(app.db, admin, x.m1!, "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found/);
    await expect(assertConsentUsable(app.db, as("manager", x.m1!), x.m1!, c!.id)).rejects.toBeInstanceOf(ForbiddenError);
    await owner.db.insert(voiceProfiles).values({ orgId: x.org!, label: "v", gender: "male", providerVoiceId: `pv-${tag}`, donorUserId: x.m1!, consentRecordId: c!.id });
    await expect(assertConsentUsable(app.db, admin, x.m1!, c!.id)).rejects.toThrow(/already linked/);
  });

  it("gives the agent console the org's AI prompt to any studio user", async () => {
    expect((await getAgentConfig(app.db, as("manager", x.m1!))).disclosure).toContain("AI assistant");
    await expect(getAgentConfig(app.db, as("agent", "a"))).rejects.toBeInstanceOf(ForbiddenError);
  });
});
