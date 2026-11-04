import { z } from "zod";
import { submitKyc } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({ tier: z.enum(["basic", "business"]), legalName: z.string().max(120), pan: z.string().max(10), gstin: z.string().max(15).optional(), contactName: z.string().max(80), contactPhone: z.string().max(20), address: z.string().max(300) });

/** Asks to be verified. A person at the platform reviews it. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await submitKyc(getDb(), user, body.parse(await req.json().catch(() => null))), { status: 201 }); } catch (err) { return toResponse(err); }
}
