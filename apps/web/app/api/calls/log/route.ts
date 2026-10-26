import { logDialerCall } from "@voiceai/db";
import { logCallSchema } from "@voiceai/shared";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** Logs a call made from the web dialer, so it appears in the call logs and on the lead. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const input = logCallSchema.parse(await req.json().catch(() => null));
    const saved = await logDialerCall(getDb(), user, { ...input, startedAt: new Date(input.startedAt) });
    return saved ? Response.json(saved) : Response.json({ error: "invalid_request", message: "That is not a valid phone number." }, { status: 400 });
  } catch (err) {
    return toResponse(err);
  }
}
