import { eq, sql } from "drizzle-orm";
import { hashRecoveryCode, parseRecoveryHashes } from "./mfa-codes";
import {
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hashPassword,
  MFA_REQUIRED_ROLES,
  totpUri,
  verifyPassword,
  verifyTotp,
  type AuthUser,
  type RoleKey,
} from "@voiceai/auth";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { roles, teams, userRoles, users } from "./schema";

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

export type LoginResult =
  | { ok: true; user: AuthUser; roleKeys: string[] }
  /** Callers must show one generic message for every failure except the two MFA prompts. */
  | { ok: false; reason: "invalid_credentials" | "locked" | "mfa_required" }
  /** Password was correct; the caller may issue a short-lived enrol-only token for this user. */
  | { ok: false; reason: "mfa_enrollment_required"; userId: string; orgId: string };

export interface LoginInput {
  email: string;
  password: string;
  totp?: string;
  ip?: string;
  userAgent?: string;
}

export interface LoginDeps {
  /** 32-byte AES key for MFA secrets. */
  encryptionKey: Buffer;
  now?: () => Date;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

async function rolesAndTeams(tx: Tx, userId: string, ownTeamId: string | null) {
  const roleRows = await tx
    .select({ key: roles.key, permissions: roles.permissions })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId));
  const managed = await tx.select({ id: teams.id }).from(teams).where(eq(teams.managerUserId, userId));
  return {
    roleKeys: roleRows.map((r) => r.key),
    permissions: [...new Set(roleRows.flatMap((r) => r.permissions))],
    teamIds: [...new Set([...(ownTeamId ? [ownTeamId] : []), ...managed.map((t) => t.id)])],
  };
}

/** Fresh AuthUser for a session; null if the user is gone or not active, so suspension takes effect at once. */
export async function loadAuthUser(db: Db, orgId: string, userId: string): Promise<AuthUser | null> {
  return withOrg(db, orgId, async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId));
    if (!u || u.status !== "active") return null;
    const { permissions, teamIds } = await rolesAndTeams(tx, u.id, u.teamId);
    return { id: u.id, orgId: u.orgId, teamIds, permissions };
  });
}

// Hash of a random password, verified when the email is unknown so response time does not reveal which emails exist.
let dummyHash: Promise<string> | undefined;

export async function login(db: Db, input: LoginInput, deps: LoginDeps): Promise<LoginResult> {
  const now = deps.now?.() ?? new Date();
  const email = input.email.trim().toLowerCase();

  const found = await db.execute<{
    id: string; org_id: string; team_id: string | null; password_hash: string; mfa_secret_enc: string | null;
    mfa_last_step: string | null; status: string; failed_login_count: number; locked_until: string | Date | null;
  }>(sql`select * from auth_find_user(${email})`);
  const row = found.rows[0];

  if (!row) {
    await verifyPassword(await (dummyHash ??= hashPassword(crypto.randomUUID())), input.password);
    return { ok: false, reason: "invalid_credentials" };
  }

  const audit = (tx: Parameters<typeof writeAudit>[0], action: string, extra?: object) =>
    writeAudit(tx, { orgId: row.org_id, actorUserId: row.id, action, entity: "users", entityId: row.id, ip: input.ip, userAgent: input.userAgent, after: extra });

  return withOrg(db, row.org_id, async (tx): Promise<LoginResult> => {
    if (row.status !== "active") return { ok: false, reason: "invalid_credentials" };
    // Raw SQL results are not parsed by Drizzle, so timestamptz arrives as a string.
    if (row.locked_until && new Date(row.locked_until) > now) return { ok: false, reason: "locked" };

    const fail = async (why: string): Promise<LoginResult> => {
      const count = row.failed_login_count + 1;
      const lock = count >= MAX_FAILED_LOGINS;
      await tx
        .update(users)
        .set({ failedLoginCount: lock ? 0 : count, lockedUntil: lock ? new Date(now.getTime() + LOCKOUT_MS) : null })
        .where(eq(users.id, row.id));
      await audit(tx, "login.failed", { why, locked: lock });
      return { ok: false, reason: lock ? "locked" : "invalid_credentials" };
    };

    if (!(await verifyPassword(row.password_hash, input.password))) return fail("password");

    const { roleKeys, permissions, teamIds } = await rolesAndTeams(tx, row.id, row.team_id);
    const mfaRequired = roleKeys.some((k) => (MFA_REQUIRED_ROLES as readonly string[]).includes(k as RoleKey));

    let step: number | null = null;
    if (row.mfa_secret_enc) {
      if (!input.totp) return { ok: false, reason: "mfa_required" };
      if (/^\d{6}$/.test(input.totp)) {
        const secret = decryptSecret(row.mfa_secret_enc, deps.encryptionKey);
        step = verifyTotp(secret, input.totp, now.getTime(), row.mfa_last_step ? Number(row.mfa_last_step) : -1);
        if (step === null) return fail("totp");
      } else {
        // Not a 6-digit code: treat it as a one-time recovery code and use it up.
        const [rc] = await tx.select({ c: users.mfaRecoveryCodes }).from(users).where(eq(users.id, row.id));
        const hashes = parseRecoveryHashes(rc?.c);
        const at = hashes.indexOf(hashRecoveryCode(input.totp));
        if (at < 0) return fail("recovery");
        hashes.splice(at, 1);
        await tx.update(users).set({ mfaRecoveryCodes: JSON.stringify(hashes) }).where(eq(users.id, row.id));
        await audit(tx, "mfa.recovery_used", { left: hashes.length });
      }
    } else if (mfaRequired) {
      return { ok: false, reason: "mfa_enrollment_required", userId: row.id, orgId: row.org_id };
    }

    await tx
      .update(users)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: now, ...(step !== null && { mfaLastStep: step }) })
      .where(eq(users.id, row.id));
    await audit(tx, "login.success");

    return {
      ok: true,
      roleKeys,
      user: { id: row.id, orgId: row.org_id, teamIds, permissions },
    };
  });
}

/** Step 1 of enrolment: nothing is stored. Keep `secret` in the session and show the URI as a QR code. */
export function beginMfaEnrollment(email: string) {
  const secret = generateTotpSecret();
  return { secret, uri: totpUri(secret, email) };
}

/** Step 2: enables 2FA only after the user proves their authenticator produces a valid code. */
export async function confirmMfaEnrollment(
  db: Db,
  actor: { id: string; orgId: string },
  secret: string,
  code: string,
  deps: Pick<LoginDeps, "encryptionKey" | "now">,
): Promise<boolean> {
  const now = deps.now?.() ?? new Date();
  const step = verifyTotp(secret, code, now.getTime());
  if (step === null) return false;
  await withOrg(db, actor.orgId, async (tx) => {
    await tx.update(users).set({ mfaSecretEnc: encryptSecret(secret, deps.encryptionKey), mfaLastStep: step }).where(eq(users.id, actor.id));
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "mfa.enrolled", entity: "users", entityId: actor.id });
  });
  return true;
}

export async function getUserEmail(db: Db, orgId: string, userId: string): Promise<string | null> {
  const [u] = await withOrg(db, orgId, (tx) => tx.select({ email: users.email }).from(users).where(eq(users.id, userId)));
  return u?.email ?? null;
}
