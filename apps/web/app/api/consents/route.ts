import { createConsentRecord } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const record = await createConsentRecord(getDb(), user, await req.json().catch(() => null));
    return Response.json(record, { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
}
