import { z } from "zod";
import { createWidget, listWidgets } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({ name: z.string().trim().min(1).max(80), origins: z.array(z.string().max(200)).min(1).max(10), language: z.enum(["en", "hi", "en-hi"]).default("en-hi"), voice: z.string().max(120).optional() });

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await listWidgets(getDb(), user)); } catch (err) { return toResponse(err); }
}

/** Makes a website widget. The key is public: the list of allowed sites is what protects it. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await createWidget(getDb(), user, body.parse(await req.json().catch(() => null))), { status: 201 }); } catch (err) { return toResponse(err); }
}
