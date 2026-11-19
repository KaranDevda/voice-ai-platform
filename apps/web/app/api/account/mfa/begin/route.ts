import { beginMfaEnrollment, getUserProfile } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** Signed-in person starts turning on 2FA: returns a new secret and an otpauth link for their authenticator app. Nothing is saved until /confirm. */
export async function POST() {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const { email } = await getUserProfile(getDb(), user);
    return Response.json(beginMfaEnrollment(email));
  } catch (err) { return toResponse(err); }
}
