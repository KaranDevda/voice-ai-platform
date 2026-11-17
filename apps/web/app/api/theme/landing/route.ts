import { z } from "zod";
import { setLandingText } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({
  headline: z.string().min(0).max(60),
  text: z.string().min(0).max(140),
});

export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.includes("platform.admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.formData().catch(() => null));
  // formData doesn't parse to object directly, so we need to handle it
  const formData = await req.formData().catch(() => new FormData());
  const obj = Object.fromEntries(formData.entries());
  const parsed2 = body.safeParse(obj);
  if (!parsed2.success) return Response.json({ error: "invalid_request", issues: parsed2.error.issues }, { status: 400 });
  try {
    const result = await setLandingText(getDb(), user, parsed2.data);
    return Response.json(result);
  } catch (err) { return toResponse(err); }
}