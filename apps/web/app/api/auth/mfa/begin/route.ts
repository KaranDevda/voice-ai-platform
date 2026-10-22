import { cookies } from "next/headers";
import { beginMfaEnrollment, getUserEmail } from "@voiceai/db";
import { assertSameOrigin, getDb } from "@/lib/server";
import { json } from "@/lib/auth-routes";
import { cookieOptions, ENROLL_COOKIE, ENROLL_TTL_S, signToken, verifyToken, type EnrollClaims } from "@/lib/session";

export async function POST() {
  if (!(await assertSameOrigin())) return json({ error: "bad_origin" }, 403);
  const jar = await cookies();
  const claims = await verifyToken<EnrollClaims>(jar.get(ENROLL_COOKIE)?.value, "enroll");
  if (!claims) return json({ error: "unauthenticated" }, 401);

  const email = await getUserEmail(getDb(), claims.org, claims.sub);
  if (!email) return json({ error: "unauthenticated" }, 401);

  const { secret, uri } = beginMfaEnrollment(email);
  jar.set(ENROLL_COOKIE, await signToken({ sub: claims.sub, org: claims.org, secret }, ENROLL_TTL_S, "enroll"), cookieOptions(ENROLL_TTL_S));
  return json({ secret, uri });
}
