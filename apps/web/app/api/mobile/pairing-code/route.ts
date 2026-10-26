import { createPairingCode } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** A signed-in person asks for a code to type into the phone app. */
export async function POST() {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const { code, expiresAt } = await createPairingCode(getDb(), user);
    return Response.json({ code, expiresAt: expiresAt.toISOString() });
  } catch (err) {
    return toResponse(err);
  }
}
