import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { hashPassword, verifyPassword } from "@voiceai/auth";
import { passwordProblem } from "@voiceai/shared";
import type { Db } from "./client";

export class PasswordError extends Error {}

/** A short code for the stored password. A reset link carries it, so the link stops working as soon as the password changes (it works once). */
export const passwordFingerprint = (storedHash: string) => createHash("sha256").update(storedHash, "utf8").digest("hex").slice(0, 32);

type FoundUser = { id: string; org_id: string; password_hash: string; status: string };
const find = async (db: Db, email: string) => (await db.execute<FoundUser>(sql`select id, org_id, password_hash, status from auth_find_user(${email.trim().toLowerCase()})`)).rows[0];

/** For "forgot password": who the e-mail belongs to, if anyone active. The caller must never tell the visitor whether it found someone. */
export async function findUserForReset(db: Db, email: string): Promise<{ userId: string; orgId: string; fingerprint: string } | null> {
  const u = await find(db, email);
  return u && u.status === "active" ? { userId: u.id, orgId: u.org_id, fingerprint: passwordFingerprint(u.password_hash) } : null;
}

/** Sets a new password from a reset link. False when the link was already used or the account is no longer active. */
export async function resetPassword(db: Db, userId: string, fingerprint: string, newPassword: string, email: string): Promise<boolean> {
  const problem = passwordProblem(newPassword, email);
  if (problem) throw new PasswordError(problem);
  const org = (await db.execute<{ r: string | null }>(sql`select auth_set_password(${userId}::uuid, ${fingerprint}, ${await hashPassword(newPassword)}, 'password.reset') as r`)).rows[0]?.r;
  return !!org;
}

/** A signed-in person changes their own password: the current one must be right (and a wrong one counts nowhere: the session already proves who they are). */
export async function changePassword(db: Db, email: string, current: string, next: string): Promise<void> {
  const u = await find(db, email);
  if (!u || u.status !== "active" || !(await verifyPassword(u.password_hash, current))) throw new PasswordError("the current password is not right");
  const problem = passwordProblem(next, email);
  if (problem) throw new PasswordError(problem);
  if (next === current) throw new PasswordError("choose a password you have not used just now");
  const org = (await db.execute<{ r: string | null }>(sql`select auth_set_password(${u.id}::uuid, ${passwordFingerprint(u.password_hash)}, ${await hashPassword(next)}, 'password.change') as r`)).rows[0]?.r;
  if (!org) throw new PasswordError("the password could not be changed; try again");
}
