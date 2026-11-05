import { z } from "zod";
import { changePassword, getUserProfile } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** A signed-in person changes their own password. The current password is checked again, even though they are signed in. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = z.object({ current: z.string().min(1).max(500), next: z.string().min(1).max(500) }).safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const { email } = await getUserProfile(getDb(), user);
    await changePassword(getDb(), email, b.data.current, b.data.next);
    return Response.json({ ok: true });
  } catch (err) { return toResponse(err); }
}
