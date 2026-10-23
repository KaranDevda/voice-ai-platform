import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, hashPassword, hotp, TOTP_STEP_S } from "@voiceai/auth";
import { createDb } from "./client";
import { beginMfaEnrollment, confirmMfaEnrollment, loadAuthUser, login, MAX_FAILED_LOGINS } from "./login";
import { organizations, roles, userRoles, users } from "./schema";

const ownerUrl = process.env.TEST_DATABASE_URL;
const appUrl = process.env.TEST_APP_DATABASE_URL;

describe.skipIf(!ownerUrl || !appUrl)("login", () => {
  const owner = createDb(ownerUrl ?? "");
  const app = createDb(appUrl ?? "");
  const encryptionKey = randomBytes(32);
  const tag = randomUUID().slice(0, 8);
  const ids = {} as Record<string, string>;
  const PW = "correct horse battery";

  const mkUser = async (name: string, roleKey: string) => {
    const [u] = await owner.db
      .insert(users)
      .values({ orgId: ids.org!, email: `${name}-${tag}@x.io`, passwordHash: await hashPassword(PW) })
      .returning();
    const [role] = await owner.db.select().from(roles).where(sql`${roles.key} = ${roleKey} and ${roles.orgId} is null`);
    await owner.db.insert(userRoles).values({ userId: u!.id, roleId: role!.id });
    return u!;
  };
  const attempt = (name: string, over: Partial<Parameters<typeof login>[1]> = {}, now?: Date) =>
    login(app.db, { email: `${name}-${tag}@x.io`, password: PW, ...over }, { encryptionKey, now: now ? () => now : undefined });
  const code = (secret: string, at: Date, offset = 0) => hotp(secret, Math.floor(at.getTime() / 1000 / TOTP_STEP_S) + offset);

  beforeAll(async () => {
    const [org] = await owner.db.insert(organizations).values({ name: `LoginOrg-${tag}` }).returning();
    ids.org = org!.id;
    for (const [key, perms] of Object.entries(ROLE_PERMISSIONS)) {
      await owner.db.insert(roles).values({ key, name: key, permissions: [...perms] }).onConflictDoNothing();
    }
  });
  afterAll(async () => {
    await owner.pool.end();
    await app.pool.end();
  });

  it("logs an Agent in without MFA and returns merged permissions", async () => {
    await mkUser("agent", "agent");
    const r = await attempt("agent");
    expect(r.ok && r.user.permissions).toContain("leads.read.own");
    expect(await attempt("agent", { password: "nope" })).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await attempt("ghost")).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("forces a Manager to enrol, then requires and replay-protects TOTP", async () => {
    const mgr = await mkUser("mgr", "manager");
    expect(await attempt("mgr")).toEqual({ ok: false, reason: "mfa_enrollment_required", userId: mgr.id, orgId: ids.org });

    const now = new Date();
    const { secret, uri } = beginMfaEnrollment(`mgr-${tag}@x.io`);
    expect(uri).toContain(secret);
    expect(await confirmMfaEnrollment(app.db, mgr, secret, "000000", { encryptionKey, now: () => now })).toBe(false);
    expect(await confirmMfaEnrollment(app.db, mgr, secret, code(secret, now), { encryptionKey, now: () => now })).toBe(true);

    expect(await attempt("mgr")).toEqual({ ok: false, reason: "mfa_required" });
    const later = new Date(now.getTime() + 2 * TOTP_STEP_S * 1000);
    expect((await attempt("mgr", { totp: code(secret, later) }, later)).ok).toBe(true);
    // Same code again is a replay.
    expect(await attempt("mgr", { totp: code(secret, later) }, later)).toEqual({ ok: false, reason: "invalid_credentials" });

    const [row] = (await owner.db.execute(sql`select mfa_secret_enc from users where id = ${mgr.id}`)).rows;
    expect(row!.mfa_secret_enc).not.toContain(secret);
  });

  it("locks after 5 failures, even for the right password, until the lock expires", async () => {
    await mkUser("lock", "agent");
    const now = new Date();
    for (let i = 1; i < MAX_FAILED_LOGINS; i++) {
      expect(await attempt("lock", { password: "bad" }, now)).toEqual({ ok: false, reason: "invalid_credentials" });
    }
    expect(await attempt("lock", { password: "bad" }, now)).toEqual({ ok: false, reason: "locked" });
    expect(await attempt("lock", {}, now)).toEqual({ ok: false, reason: "locked" });
    expect((await attempt("lock", {}, new Date(now.getTime() + 16 * 60_000))).ok).toBe(true);
  });

  it("loadAuthUser reflects suspension immediately", async () => {
    const u = await mkUser("susp", "agent");
    expect((await loadAuthUser(app.db, ids.org!, u.id))?.permissions).toContain("calls.place");
    await owner.db.execute(sql`update users set status = 'suspended' where id = ${u.id}`);
    expect(await loadAuthUser(app.db, ids.org!, u.id)).toBeNull();
  });

  it("audits logins", async () => {
    const r = await owner.db.execute(sql`select distinct action from audit_logs where org_id = ${ids.org} order by 1`);
    expect(r.rows.map((x) => x.action)).toEqual(["login.failed", "login.success", "mfa.enrolled"]);
  });
});
