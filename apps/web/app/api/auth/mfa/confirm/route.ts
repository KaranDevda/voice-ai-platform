import { cookies } from "next/headers";
import { z } from "zod";
import { confirmMfaEnrollment } from "@voiceai/db";
import { assertSameOrigin, encryptionKey, getDb } from "@/lib/server";
import { json, startSession } from "@/lib/auth-routes";
import { ENROLL_COOKIE, verifyToken, type EnrollClaims } from "@/lib/session";

export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return json({ error: "bad_origin" }, 403);
  const body = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_request" }, 400);

  const jar = await cookies();
  const claims = await verifyToken<EnrollClaims>(jar.get(ENROLL_COOKIE)?.value, "enroll");
  if (!claims?.secret) return json({ error: "unauthenticated" }, 401);

  const ok = await confirmMfaEnrollment(getDb(), { id: claims.sub, orgId: claims.org }, claims.secret, body.data.code, {
    encryptionKey: encryptionKey(),
  });
  if (!ok) return json({ error: "invalid_code" }, 400);

  // Password and a fresh TOTP have both been proven, so sign the user in directly.
  jar.delete(ENROLL_COOKIE);
  await startSession(jar, { sub: claims.sub, org: claims.org });
  return json({ ok: true });
}
