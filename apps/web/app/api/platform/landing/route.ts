import { z } from "zod";
import { setLandingText } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** Platform staff: the headline and the line under the logo on the sign-in page. Empty puts the standard text back. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = z.object({ headline: z.string().max(200), text: z.string().max(400) }).safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try { return Response.json(await setLandingText(getDb(), user, b.data)); } catch (err) { return toResponse(err); }
}
