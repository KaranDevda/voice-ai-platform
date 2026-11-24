import { randomUUID } from "node:crypto";
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, ROLE_PERMISSIONS, type AuthUser, type RoleKey } from "@voiceai/auth";
import { eq, sql } from "drizzle-orm";
import { createDb } from "./client";
import { listCallBookings, saveCallBooking } from "./call-bookings";
import { listCrmInbound, syncContactsFromCrm } from "./crm-sync";
import { applyPlatformSecrets, deletePlatformSecret, listPlatformSecrets, setPlatformSecret } from "./platform-secrets";
import { submitKyc, type KycChecker } from "./platform-admin";
import { callBookings, crmDeliveries, crmEndpoints, leadStatusHistory, leads, organizations, platformSecrets, roles, userRoles, users } from "./schema";

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("admin features: CRM sync, provider keys, bookings, KYC government check", () => {
  const owner = createDb(ownerUrl ?? "");
  const app = createDb(appUrl ?? "");
  const x = {} as Record<string, string>;
  const tag = randomUUID().slice(0, 8);
  const as = (role: RoleKey, id: string, orgId = x.org!): AuthUser => ({ id, orgId, teamIds: [], permissions: [...ROLE_PERMISSIONS[role]] });
  const key = randomBytes(32);

  beforeAll(async () => {
    const db = owner.db;
    const [org, other] = await db.insert(organizations).values([{ name: `F-${tag}` }, { name: `G-${tag}` }]).returning();
    const [admin, agent, staff, mgr] = await db.insert(users).values([
      { orgId: org!.id, email: `admin-${tag}@x.io`, passwordHash: "x" },
      { orgId: org!.id, email: `agent-${tag}@x.io`, passwordHash: "x" },
      { orgId: org!.id, email: `staff-${tag}@x.io`, passwordHash: "x" },
      { orgId: org!.id, email: `mgr-${tag}@x.io`, passwordHash: "x" },
    ]).returning();
    for (const k of ["org_admin", "manager", "agent", "super_admin"] as const) await db.insert(roles).values({ key: k, name: k, permissions: [...ROLE_PERMISSIONS[k]] }).onConflictDoNothing();
    const roleId = async (k: string) => (await db.select({ id: roles.id }).from(roles).where(sql`${roles.key} = ${k} and ${roles.orgId} is null`))[0]!.id;
    await db.insert(userRoles).values([{ userId: admin!.id, roleId: await roleId("org_admin") }, { userId: mgr!.id, roleId: await roleId("manager") }]);
    // An active CRM address subscribed to lead events, to prove changes from the CRM are not echoed back to it.
    await db.insert(crmEndpoints).values({ orgId: org!.id, name: "CRM", url: "https://crm.example.com/hook", secret: "s" });
    const [existing] = await db.insert(leads).values({ orgId: org!.id, ownerUserId: admin!.id, name: "Old Name", phoneE164: "+919820000001", tags: ["ours"] }).returning();
    Object.assign(x, { org: org!.id, other: other!.id, admin: admin!.id, agent: agent!.id, staff: staff!.id, existing: existing!.id });
  });

  afterAll(async () => {
    await owner.db.delete(platformSecrets).where(sql`${platformSecrets.name} in ('OPENROUTER_API_KEY', 'SMTP_HOST')`);
    await owner.pool.end(); await app.pool.end();
  });

  describe("two-way CRM sync (incoming)", () => {
    it("creates and updates leads by phone, records status history, and refuses bad rows", async () => {
      const before = (await owner.db.select({ n: sql<number>`count(*)::int` }).from(crmDeliveries).where(eq(crmDeliveries.orgId, x.org!)))[0]!.n;
      const r = await syncContactsFromCrm(app.db, as("org_admin", x.admin!), [
        { phone: "098200 00001", name: "New Name", email: "NEW@Example.com", status: "interested", tags: ["crm"], externalId: "crm-1" },
        { phone: "+91 98200 00002", name: "Fresh Lead", status: "contacted" },
        { phone: "12", name: "Bad Phone" },
        { phone: "+919820000003", status: "maybe" },
        { phone: "+919820000002", name: "Repeat" },
      ]);
      expect(r).toMatchObject({ received: 5, created: 1, updated: 1, statusChanges: 1, invalid: 3 });
      expect(r.problems.map((p) => p.problem)).toEqual(["not a valid phone number", 'unknown status "maybe"', "the same number appears twice in this batch"]);
      const [updated] = await owner.db.select().from(leads).where(eq(leads.id, x.existing!));
      expect(updated).toMatchObject({ name: "New Name", email: "new@example.com", status: "interested" });
      expect([...updated!.tags].sort()).toEqual(["crm", "ours"]);
      expect(updated!.customFields).toMatchObject({ crm_id: "crm-1" });
      const history = await owner.db.select().from(leadStatusHistory).where(eq(leadStatusHistory.leadId, x.existing!));
      expect(history.at(-1)).toMatchObject({ fromStatus: "new", toStatus: "interested", reason: "CRM sync" });
      // No echo: nothing was queued back to the CRM for these changes.
      const after = (await owner.db.select({ n: sql<number>`count(*)::int` }).from(crmDeliveries).where(eq(crmDeliveries.orgId, x.org!)))[0]!.n;
      expect(after).toBe(before);
      expect((await listCrmInbound(app.db, as("org_admin", x.admin!)))[0]).toMatchObject({ received: 5, created: 1, updated: 1, invalid: 3 });
    });

    it("still sends ordinary lead changes to the CRM (only CRM-made changes are skipped)", async () => {
      await owner.db.insert(leads).values({ orgId: x.org!, name: "Made Here", phoneE164: "+919820000099" });
      const n = (await owner.db.select({ n: sql<number>`count(*)::int` }).from(crmDeliveries).where(sql`${crmDeliveries.orgId} = ${x.org!} and ${crmDeliveries.event} = 'lead.created' and ${crmDeliveries.payload}->'data'->>'phone' = '+919820000099'`))[0]!.n;
      expect(n).toBe(1);
    });

    it("needs leads.write, and a narrow scope cannot update other people's leads", async () => {
      await expect(syncContactsFromCrm(app.db, as("viewer", x.agent!), [{ phone: "+919820000005" }])).rejects.toBeInstanceOf(ForbiddenError);
      const r = await syncContactsFromCrm(app.db, as("agent", x.agent!), [{ phone: "+919820000001", name: "Agent Rename" }, { phone: "+919820000006", name: "Agent New" }]);
      expect(r).toMatchObject({ created: 1, updated: 0, invalid: 1 });
      expect(r.problems[0]!.problem).toBe("this token may only update its own contacts");
    });
  });

  describe("provider keys set from the website", () => {
    it("platform staff only; stored encrypted; listed with a hint, never the value; applied to the environment and removable", async () => {
      await expect(setPlatformSecret(app.db, as("org_admin", x.admin!), "OPENROUTER_API_KEY", "sk-or-v1-abcdefgh1234", key)).rejects.toBeInstanceOf(ForbiddenError);
      const staff = as("super_admin", x.staff!);
      await expect(setPlatformSecret(app.db, staff, "NOT_ALLOWED_KEY", "x", key)).rejects.toThrow(/cannot be set/);
      const prev = process.env.OPENROUTER_API_KEY;
      await setPlatformSecret(app.db, staff, "OPENROUTER_API_KEY", "sk-or-v1-abcdefgh1234", key);
      const [row] = await owner.db.select().from(platformSecrets).where(eq(platformSecrets.name, "OPENROUTER_API_KEY"));
      expect(row!.valueEnc).not.toContain("abcdefgh1234");
      expect(row!.hint).toBe("…1234");
      const listed = (await listPlatformSecrets(app.db, staff)).find((k) => k.name === "OPENROUTER_API_KEY")!;
      expect(listed).toMatchObject({ source: "website", hint: "…1234" });
      expect(JSON.stringify(await listPlatformSecrets(app.db, staff))).not.toContain("abcdefgh1234");
      expect(process.env.OPENROUTER_API_KEY).toBe("sk-or-v1-abcdefgh1234");
      expect(await applyPlatformSecrets(app.db, key)).toContain("OPENROUTER_API_KEY");
      await deletePlatformSecret(app.db, staff, "OPENROUTER_API_KEY");
      expect(process.env.OPENROUTER_API_KEY).toBe(prev);
      // An organisation's own connection (no platform switch) cannot read the table at all.
      const seen = await app.db.transaction(async (tx) => { await tx.execute(sql`select set_config('app.org_id', ${x.org!}, true)`); return tx.select().from(platformSecrets); });
      expect(seen).toHaveLength(0);
    });
  });

  describe("bookings made by the AI on a call", () => {
    it("saves a booking, replaces an earlier one from the same call, marks the lead and lists who to tell", async () => {
      const callId = randomUUID();
      const first = await saveCallBooking(app.db, x.org!, { callerName: "Karan", scheduledFor: new Date("2026-11-24T07:30:00Z"), language: "hinglish", leadId: x.existing!, callId });
      expect(first.notify.sort()).toEqual([`admin-${tag}@x.io`, `mgr-${tag}@x.io`]);
      await saveCallBooking(app.db, x.org!, { callerName: "Karan", scheduledFor: new Date("2026-11-24T08:30:00Z"), language: "hinglish", leadId: x.existing!, callId, replacesEarlier: true });
      const rows = await owner.db.select().from(callBookings).where(eq(callBookings.callId, callId));
      expect(rows.map((r) => r.status).sort()).toEqual(["cancelled", "requested"]);
      expect((await owner.db.select({ s: leads.status }).from(leads).where(eq(leads.id, x.existing!)))[0]!.s).toBe("callback_requested");
      const listed = await listCallBookings(app.db, as("org_admin", x.admin!));
      expect(listed.filter((b) => b.callId === callId)).toHaveLength(2);
      // Another organisation sees none of them.
      expect(await listCallBookings(app.db, as("org_admin", randomUUID(), x.other!))).toHaveLength(0);
    });
  });

  describe("KYC: real PAN and GSTIN checks", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n% test\n");
    const input = { tier: "business" as const, legalName: "Bizfy Demo Pvt Ltd", pan: "HRQPD2324F", gstin: "23HRQPD2324F1Z1", contactName: "Karan Devda", contactPhone: "+919812345678", address: "12 MG Road, Bhopal", documents: [{ kind: "pan" as const, fileName: "pan.pdf", data: pdf }, { kind: "gst" as const, fileName: "gst.pdf", data: pdf }] };
    const checker = (pan: "valid" | "invalid" | "error", gst: "valid" | "invalid"): KycChecker => ({
      provider: "test",
      verifyPan: async () => (pan === "error" ? Promise.reject(new Error("service down")) : { status: pan, registeredName: "BIZFY DEMO PRIVATE LIMITED", nameMatchScore: 88 }),
      verifyGstin: async () => ({ status: gst, gstStatus: gst === "valid" ? "Active" : "Cancelled" }),
    });

    it("refuses a PAN the government records do not know, and a cancelled GSTIN", async () => {
      await expect(submitKyc(app.db, as("org_admin", x.admin!), input, checker("invalid", "valid"))).rejects.toThrow(/not a valid, active PAN/);
      await expect(submitKyc(app.db, as("org_admin", x.admin!), input, checker("valid", "invalid"))).rejects.toThrow(/not active in the GST records \(status: Cancelled\)/);
    });

    it("stores what the government records said, and lets a request through when the service is down", async () => {
      const r = await submitKyc(app.db, as("org_admin", x.admin!), input, checker("error", "valid"));
      expect(r.verification).toMatchObject({ provider: "test", pan: { status: "error" }, gstin: { status: "valid", gstStatus: "Active" } });
    });
  });
});
