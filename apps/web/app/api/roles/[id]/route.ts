import { z } from "zod";
import { setRoleScope, updateRole } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const patch = z.union([
  z.object({ permission: z.string().min(1).max(100), add: z.boolean() }),
  z.object({ base: z.string().min(1).max(100), scope: z.string().max(20).nullable() }),
]);

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.includes("platform.admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  const id = z.string().min(1).max(50).safeParse((await params).id);
  if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  const parsed = patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  try {
    const d = parsed.data;
    const role = "base" in d ? await setRoleScope(getDb(), user, id.data, d.base, d.scope) : await updateRole(getDb(), user, id.data, d.permission, d.add);
    return Response.json(role);
  } catch (err) { return toResponse(err); }
}