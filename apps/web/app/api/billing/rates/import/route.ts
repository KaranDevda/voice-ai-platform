import { z } from "zod";
import { importCountryRates } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** Bulk price list: { text: "country,call_per_min_paise,sms_paise\nIN,150,25\n..." } */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = z.object({ text: z.string().min(1).max(200_000) }).safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try { return Response.json(await importCountryRates(getDb(), user, b.data.text), { status: 201 }); } catch (err) { return toResponse(err); }
}
