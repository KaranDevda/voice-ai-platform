import { cookies } from "next/headers";
import { auditImpersonation, loadAuthUser } from "@voiceai/db";
import { assertSameOrigin, getDb } from "@/lib/server";
import { cookieOptions, SESSION_COOKIE, SESSION_TTL_S, signToken, verifyToken, type SessionClaims } from "@/lib/session";

/** Back to being yourself. Works only from an impersonated session, and only if the staff member is still active staff. */
export async function POST() {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const jar = await cookies();
  const claims = await verifyToken<SessionClaims>(jar.get(SESSION_COOKIE)?.value, "session");
  if (!claims?.impBy || !claims.impOrg) return Response.json({ error: "not_impersonating" }, { status: 400 });
  const admin = await loadAuthUser(getDb(), claims.impOrg, claims.impBy);
  if (!admin || !admin.permissions.includes("platform.admin")) { jar.delete(SESSION_COOKIE); return Response.json({ ok: true, signedOut: true }); }
  await auditImpersonation(getDb(), admin, { id: claims.sub, orgId: claims.org }, "admin.impersonate_stop").catch(() => {});
  jar.set(SESSION_COOKIE, await signToken({ sub: admin.id, org: admin.orgId }, SESSION_TTL_S, "session"), cookieOptions(SESSION_TTL_S));
  return Response.json({ ok: true });
}
