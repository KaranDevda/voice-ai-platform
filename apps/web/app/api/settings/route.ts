import { updateOrgSettings } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

export async function PUT(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    await updateOrgSettings(getDb(), user, await req.json().catch(() => null));
    return Response.json({ ok: true });
  } catch (err) {
    return toResponse(err);
  }
}
