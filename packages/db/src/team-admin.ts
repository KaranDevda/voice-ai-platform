import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { assertAuthorized, hashPassword, verifyPassword, type AuthUser } from "@voiceai/auth";
import { passwordProblem } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { withOrg, type Db, type DbTx } from "./client";
import { PasswordError } from "./password";
import { roles, teams, userRoles, users } from "./schema";

/** A refused team change, in words the admin can act on. */
export class TeamError extends Error {}

/** Roles an organisation admin may give. super_admin (platform staff) is never handed out from a customer's Team page. */
export const ASSIGNABLE_ROLES = ["org_admin", "manager", "agent", "qa_auditor", "viewer"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** Checks the signed-in person's own password again, for changes that need a second "are you sure" (organisation settings). */
export async function confirmOwnPassword(db: Db, actor: AuthUser, password: string): Promise<void> {
  await withOrg(db, actor.orgId, async (tx) => {
    const [u] = await tx.select({ h: users.passwordHash }).from(users).where(eq(users.id, actor.id));
    if (!u || !(await verifyPassword(u.h, password))) throw new PasswordError("the password is not right");
  });
}

/** The organisation's teams, for the "Team" choice when adding someone. */
export async function listOrgTeams(db: Db, actor: AuthUser) {
  return withOrg(db, actor.orgId, (tx) => tx.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.orgId, actor.orgId)).orderBy(teams.name));
}

async function roleKeysOf(tx: DbTx, userId: string): Promise<string[]> {
  const rows = await tx.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, userId));
  return rows.map((r) => r.key);
}

async function globalRoleId(tx: DbTx, key: string): Promise<string> {
  const [r] = await tx.select({ id: roles.id }).from(roles).where(and(eq(roles.key, key), isNull(roles.orgId)));
  if (!r) throw new TeamError(`the role ${key} is missing; run the database seed`);
  return r.id;
}

/** Active org admins other than `exceptUserId`: the organisation must always keep at least one. */
async function otherActiveAdmins(tx: DbTx, orgId: string, exceptUserId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.orgId, orgId), eq(users.status, "active"), eq(roles.key, "org_admin"), sql`${users.id} <> ${exceptUserId}`));
  return row?.n ?? 0;
}

async function loadTarget(tx: DbTx, actor: AuthUser, targetId: string) {
  const [t] = await tx.select({ id: users.id, orgId: users.orgId, teamId: users.teamId, email: users.email, status: users.status }).from(users).where(eq(users.id, targetId));
  if (!t) return null;
  assertAuthorized(actor, "users.write", { orgId: t.orgId, teamId: t.teamId, ownerUserId: targetId });
  if (targetId === actor.id) throw new TeamError("you cannot change your own role or status; ask another admin");
  const keys = await roleKeysOf(tx, targetId);
  if (keys.includes("super_admin") && !actor.permissions.includes("platform.admin")) throw new TeamError("platform staff accounts can only be changed by platform staff");
  return { ...t, keys };
}

/**
 * An admin adds a person to their own organisation with one role and a first password they pass on privately.
 * Roles that need 2FA (admin, manager, QA) are asked to set it up at their first sign-in.
 */
export async function addTeamMember(db: Db, actor: AuthUser, input: { email: string; role: AssignableRole; teamId?: string | null; password: string }) {
  assertAuthorized(actor, "users.write", { orgId: actor.orgId, teamId: input.teamId ?? null });
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new TeamError("enter a valid e-mail address");
  if (!ASSIGNABLE_ROLES.includes(input.role)) throw new TeamError("choose one of the listed roles");
  const problem = passwordProblem(input.password, email);
  if (problem) throw new TeamError(`first password: ${problem}`);
  const passwordHash = await hashPassword(input.password);
  return withOrg(db, actor.orgId, async (tx) => {
    if (input.teamId) {
      const [team] = await tx.select({ id: teams.id }).from(teams).where(and(eq(teams.id, input.teamId), eq(teams.orgId, actor.orgId)));
      if (!team) throw new TeamError("that team does not exist");
    }
    // E-mails are unique across every organisation. Checked through the same login lookup sign-in uses, so another org's user is found too.
    const taken = await tx.execute(sql`select 1 from auth_find_user(${email})`);
    if (taken.rows.length) throw new TeamError("that e-mail address is already in use");
    const [u] = await tx.insert(users).values({ orgId: actor.orgId, teamId: input.teamId ?? null, email, passwordHash, status: "active" }).returning({ id: users.id });
    await tx.insert(userRoles).values({ userId: u!.id, roleId: await globalRoleId(tx, input.role) });
    await writeAudit(tx, { orgId: actor.orgId, teamId: input.teamId ?? null, actorUserId: actor.id, action: "user.create", entity: "users", entityId: u!.id, after: { email, role: input.role, teamId: input.teamId ?? null } });
    return { id: u!.id };
  });
}

/** Gives a person exactly one role (replacing what they had). The organisation always keeps one active admin. */
export async function setMemberRole(db: Db, actor: AuthUser, targetId: string, role: AssignableRole): Promise<boolean> {
  if (!ASSIGNABLE_ROLES.includes(role)) throw new TeamError("choose one of the listed roles");
  return withOrg(db, actor.orgId, async (tx) => {
    const t = await loadTarget(tx, actor, targetId);
    if (!t) return false;
    if (t.keys.length === 1 && t.keys[0] === role) return true;
    if (t.keys.includes("org_admin") && role !== "org_admin" && (await otherActiveAdmins(tx, t.orgId, targetId)) === 0) throw new TeamError("this is the only admin; make someone else an admin first");
    const keep = t.keys.filter((k) => k === "super_admin"); // never strip platform staff here
    const drop = t.keys.filter((k) => k !== "super_admin");
    if (drop.length) {
      const removeIds = (await tx.select({ id: roles.id }).from(roles).where(inArray(roles.key, drop))).map((r) => r.id);
      if (removeIds.length) await tx.delete(userRoles).where(and(eq(userRoles.userId, targetId), inArray(userRoles.roleId, removeIds)));
    }
    await tx.insert(userRoles).values({ userId: targetId, roleId: await globalRoleId(tx, role) }).onConflictDoNothing();
    await writeAudit(tx, { orgId: actor.orgId, teamId: t.teamId, actorUserId: actor.id, action: "user.role_change", entity: "users", entityId: targetId, before: { roles: t.keys }, after: { roles: [...keep, role] } });
    return true;
  });
}

/** Switches a person off (they cannot sign in) or back on. The organisation always keeps one active admin. */
export async function setMemberStatus(db: Db, actor: AuthUser, targetId: string, status: "active" | "disabled"): Promise<boolean> {
  return withOrg(db, actor.orgId, async (tx) => {
    const t = await loadTarget(tx, actor, targetId);
    if (!t) return false;
    if (t.status === status) return true;
    if (status === "disabled" && t.keys.includes("org_admin") && (await otherActiveAdmins(tx, t.orgId, targetId)) === 0) throw new TeamError("this is the only admin; make someone else an admin first");
    await tx.update(users).set({ status }).where(eq(users.id, targetId));
    await writeAudit(tx, { orgId: actor.orgId, teamId: t.teamId, actorUserId: actor.id, action: status === "disabled" ? "user.disable" : "user.enable", entity: "users", entityId: targetId, before: { status: t.status }, after: { status } });
    return true;
  });
}
