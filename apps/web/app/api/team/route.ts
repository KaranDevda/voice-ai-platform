import { z } from "zod";
import { addTeamMember, ASSIGNABLE_ROLES } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({
  email: z.string().min(3).max(320),
  role: z.enum(ASSIGNABLE_ROLES),
  teamId: z.string().uuid().nullable().optional(),
  password: z.string().min(1).max(200),
});

/** An admin adds a person to their organisation. Audited as user.create. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "invalid_request", issues: b.error.issues }, { status: 400 });
  try { return Response.json(await addTeamMember(getDb(), user, b.data), { status: 201 }); } catch (err) { return toResponse(err); }
}
