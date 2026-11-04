import { z } from "zod";
import { deleteCountryRate, listCountryRates, saveCountryRate } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({ country: z.string().length(2), callPerMinPaise: z.number().int().min(0).max(100_000), smsPaise: z.number().int().min(0).max(100_000) });

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await listCountryRates(getDb(), user)); } catch (err) { return toResponse(err); }
}
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await saveCountryRate(getDb(), user, body.parse(await req.json().catch(() => null)))); } catch (err) { return toResponse(err); }
}
export async function DELETE(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await deleteCountryRate(getDb(), user, new URL(req.url).searchParams.get("country") ?? "")); } catch (err) { return toResponse(err); }
}
