import { z } from "zod";
import { listTranslationOverridesOrg, upsertTranslationOverride } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({
  key: z.string().min(1).max(200),
  language: z.string().min(2).max(5),
  value: z.string().min(1).max(2000),
});

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.includes("platform.admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    const overrides = await listTranslationOverridesOrg(getDb(), user);
    return Response.json(overrides);
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
    const override = await upsertTranslationOverride(getDb(), user, parsed.data);
    return Response.json(override, { status: 201 });
  } catch (err) { return toResponse(err); }
}