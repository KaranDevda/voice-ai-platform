import { z } from "zod";
import { requestNumber } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({ kind: z.enum(["local", "tollfree"]), country: z.string().length(2).default("IN"), purpose: z.string().max(300).optional() });

export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await requestNumber(getDb(), user, body.parse(await req.json().catch(() => null))), { status: 201 }); } catch (err) { return toResponse(err); }
}
