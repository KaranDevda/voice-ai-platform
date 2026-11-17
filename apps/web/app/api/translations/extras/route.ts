import { z } from "zod";
import { listExtraLanguagesOrg, upsertExtraLanguage, updateExtraLanguage } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({
  code: z.string().min(2).max(5).toLowerCase(),
  name: z.string().min(1).max(50),
  nativeName: z.string().min(1).max(50),
  rtl: z.boolean().default(false),
});

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.includes("platform.admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    const extras = await listExtraLanguagesOrg(getDb(), user);
    return Response.json(extras);
  } catch (err) { return toResponse(err); }
}

export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.includes("platform.admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  try {
    const extra = await upsertExtraLanguage(getDb(), user, parsed.data);
    return Response.json(extra, { status: 201 });
  } catch (err) { return toResponse(err); }
}