import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { FLAG_PERMISSIONS, SCOPED_PERMISSIONS, type AuthUser, type Permission } from "@voiceai/auth";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { loadAuthUser } from "./login";
import { apiTokens } from "./schema";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export class ApiTokenError extends Error {}
const allPermissions = new Set<string>([
  ...FLAG_PERMISSIONS,
  ...Object.entries(SCOPED_PERMISSIONS).flatMap(([base, scopes]) => scopes.map((scope) => `${base}.${scope}`)),
]);
const allowedTokenPermissions = (actor: AuthUser) => actor.permissions.filter((p): p is Permission => p !== "platform.admin" && allPermissions.has(p));

export async function createApiToken(db: Db, actor: AuthUser, input: { name: string; permissions: string[]; expiresInDays: number }, now = new Date()) {
  const name = input.name.normalize("NFC").replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) throw new ApiTokenError("token name must be between 1 and 80 characters");
  if (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > 365) throw new ApiTokenError("choose an expiry from 1 to 365 days");
  const permissions = [...new Set(input.permissions)];
  const permitted = new Set(allowedTokenPermissions(actor));
  if (permissions.length === 0 || permissions.length > 60 || permissions.some((p) => !allPermissions.has(p) || !permitted.has(p as Permission))) {
    throw new ApiTokenError("choose one or more permissions that your account already has");
  }
  const token = `va_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(now.getTime() + input.expiresInDays * 86_400_000);
  const [saved] = await withOrg(db, actor.orgId, async (tx) => {
    const row = await tx.insert(apiTokens).values({
      orgId: actor.orgId, userId: actor.id, name, prefix: token.slice(0, 11), tokenHash: sha256(token),
      permissions, expiresAt,
    }).returning({ id: apiTokens.id });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "api_token.create", entity: "api_tokens", entityId: row[0]!.id, after: { name, permissions, expiresAt } });
    return row;
  });
  return { id: saved!.id, name, token, prefix: token.slice(0, 11), permissions, expiresAt };
}

export function listApiTokens(db: Db, actor: AuthUser) {
  return withOrg(db, actor.orgId, (tx) => tx.select({
    id: apiTokens.id, name: apiTokens.name, prefix: apiTokens.prefix, permissions: apiTokens.permissions,
    expiresAt: apiTokens.expiresAt, lastUsedAt: apiTokens.lastUsedAt, revokedAt: apiTokens.revokedAt, createdAt: apiTokens.createdAt,
  }).from(apiTokens).where(eq(apiTokens.userId, actor.id)).orderBy(desc(apiTokens.createdAt)));
}

export async function revokeApiToken(db: Db, actor: AuthUser, id: string, now = new Date()) {
  return withOrg(db, actor.orgId, async (tx) => {
    const [row] = await tx.update(apiTokens).set({ revokedAt: now })
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, actor.id), isNull(apiTokens.revokedAt)))
      .returning({ id: apiTokens.id, name: apiTokens.name });
    if (row) await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "api_token.revoke", entity: "api_tokens", entityId: row.id, after: { name: row.name } });
    return !!row;
  });
}

/** Validate a random bearer token, reload its owner's current roles, then narrow them to this token's saved scopes. */
export async function authenticateApiToken(db: Db, token: string): Promise<AuthUser | null> {
  if (!/^va_[A-Za-z0-9_-]{40,}$/.test(token)) return null;
  // The security-definer lookup checks expiry/revocation and updates last_used_at before returning the owner.
  const found = await db.execute<{ org_id: string; user_id: string; permissions: string[] }>(sql`select * from auth_find_api_token(${sha256(token)})`);
  const row = found.rows[0];
  if (!row) return null;
  const actor = await loadAuthUser(db, row.org_id, row.user_id);
  if (!actor) return null;
  const current = new Set(actor.permissions);
  const permissions = row.permissions.filter((p) => current.has(p) && allPermissions.has(p));
  return permissions.length ? { ...actor, permissions } : null;
}

export const API_TOKEN_PERMISSIONS = (actor: AuthUser) => allowedTokenPermissions(actor);
