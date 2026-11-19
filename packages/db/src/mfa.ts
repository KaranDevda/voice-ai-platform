import { eq, sql } from "drizzle-orm";
import { assertAuthorized, encryptSecret, MFA_REQUIRED_ROLES, verifyPassword, verifyTotp, type AuthUser, type RoleKey } from "@voiceai/auth";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { hashRecoveryCode, newRecoveryCodes, parseRecoveryHashes } from "./mfa-codes";
import { PasswordError } from "./password";
import { users } from "./schema";

export { newRecoveryCodes, hashRecoveryCode, parseRecoveryHashes, RECOVERY_CODE_COUNT } from "./mfa-codes";

type Tx = Parameters<Parameters<typeof withOrg>[2]>[0];

async function roleKeysOf(tx: Tx, userId: string): Promise<string[]> {
  const r = await tx.execute<{ key: string }>(sql`select r.key from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = ${userId}::uuid`);
  return r.rows.map((x) => x.key);
}

async function checkPassword(tx: Tx, userId: string, password: string) {
  const [u] = await tx.select({ h: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!u || !(await verifyPassword(u.h, password))) throw new PasswordError("the password is not right");
}

/** For the Account page: is 2FA on, is it compulsory for this person's role, and how many recovery codes are left. */
export async function getMfaStatus(db: Db, user: AuthUser) {
  return withOrg(db, user.orgId, async (tx) => {
    const [u] = await tx.select({ s: users.mfaSecretEnc, c: users.mfaRecoveryCodes }).from(users).where(eq(users.id, user.id));
    const roleKeys = await roleKeysOf(tx, user.id);
    return {
      enabled: !!u?.s,
      required: roleKeys.some((k) => (MFA_REQUIRED_ROLES as readonly string[]).includes(k as RoleKey)),
      recoveryLeft: parseRecoveryHashes(u?.c).length,
    };
  });
}

/** Self-service turn-on: the code from the authenticator proves the secret works. Returns the recovery codes (shown once), or null if the code was wrong. */
export async function enableMfa(db: Db, user: AuthUser, secret: string, code: string, deps: { encryptionKey: Buffer; now?: () => Date }): Promise<string[] | null> {
  const step = verifyTotp(secret, code, (deps.now?.() ?? new Date()).getTime());
  if (step === null) return null;
  const codes = newRecoveryCodes();
  await withOrg(db, user.orgId, async (tx) => {
    const [u] = await tx.select({ s: users.mfaSecretEnc }).from(users).where(eq(users.id, user.id));
    if (u?.s) throw new PasswordError("two-factor authentication is already on");
    await tx.update(users).set({ mfaSecretEnc: encryptSecret(secret, deps.encryptionKey), mfaLastStep: step, mfaRecoveryCodes: JSON.stringify(codes.map(hashRecoveryCode)) }).where(eq(users.id, user.id));
    await writeAudit(tx, { orgId: user.orgId, actorUserId: user.id, action: "mfa.enabled", entity: "users", entityId: user.id });
  });
  return codes;
}

/** Turn 2FA off. Needs the password, and is refused for roles where 2FA is compulsory. */
export async function disableMfa(db: Db, user: AuthUser, password: string): Promise<void> {
  await withOrg(db, user.orgId, async (tx) => {
    await checkPassword(tx, user.id, password);
    const roleKeys = await roleKeysOf(tx, user.id);
    if (roleKeys.some((k) => (MFA_REQUIRED_ROLES as readonly string[]).includes(k as RoleKey))) throw new PasswordError("your role requires two-factor authentication, so it cannot be turned off");
    await tx.update(users).set({ mfaSecretEnc: null, mfaLastStep: null, mfaRecoveryCodes: null }).where(eq(users.id, user.id));
    await writeAudit(tx, { orgId: user.orgId, actorUserId: user.id, action: "mfa.disabled", entity: "users", entityId: user.id });
  });
}

/** Replace all recovery codes with eight new ones (old ones stop working). Needs the password. */
export async function regenerateRecoveryCodes(db: Db, user: AuthUser, password: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await withOrg(db, user.orgId, async (tx) => {
    await checkPassword(tx, user.id, password);
    const [u] = await tx.select({ s: users.mfaSecretEnc }).from(users).where(eq(users.id, user.id));
    if (!u?.s) throw new PasswordError("turn on two-factor authentication first");
    await tx.update(users).set({ mfaRecoveryCodes: JSON.stringify(codes.map(hashRecoveryCode)) }).where(eq(users.id, user.id));
    await writeAudit(tx, { orgId: user.orgId, actorUserId: user.id, action: "mfa.recovery_regenerated", entity: "users", entityId: user.id });
  });
  return codes;
}

/** An admin clears someone's 2FA (lost phone, no recovery codes). Roles that need 2FA must enrol again at next sign-in. Not allowed on yourself. */
export async function adminResetMfa(db: Db, actor: AuthUser, targetId: string): Promise<boolean> {
  return withOrg(db, actor.orgId, async (tx) => {
    const [t] = await tx.select({ orgId: users.orgId, teamId: users.teamId }).from(users).where(eq(users.id, targetId));
    if (!t) return false;
    assertAuthorized(actor, "users.write", { orgId: t.orgId, teamId: t.teamId, ownerUserId: targetId });
    if (targetId === actor.id) throw new PasswordError("use your own Account page to change your own two-factor settings");
    await tx.update(users).set({ mfaSecretEnc: null, mfaLastStep: null, mfaRecoveryCodes: null }).where(eq(users.id, targetId));
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "mfa.admin_reset", entity: "users", entityId: targetId });
    return true;
  });
}

/** Right after forced enrolment: give the person their first recovery codes (shown once). */
export async function issueFirstRecoveryCodes(db: Db, actor: { id: string; orgId: string }): Promise<string[]> {
  const codes = newRecoveryCodes();
  await withOrg(db, actor.orgId, (tx) => tx.update(users).set({ mfaRecoveryCodes: JSON.stringify(codes.map(hashRecoveryCode)) }).where(eq(users.id, actor.id)));
  return codes;
}
