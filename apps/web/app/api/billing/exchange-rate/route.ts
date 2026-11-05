import { z } from "zod";
import { deleteExchangeRate, setExchangeRate } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** Platform staff: how many paise one unit of a currency is worth. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = z.object({ currency: z.string().length(3), paisePerUnit: z.number().positive() }).safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try { return Response.json(await setExchangeRate(getDb(), user, b.data.currency, b.data.paisePerUnit)); } catch (err) { return toResponse(err); }
}

/** Platform staff: removes a currency's rate (people can then no longer pay in it). ?currency=USD */
export async function DELETE(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const c = new URL(req.url).searchParams.get("currency") ?? "";
  if (!/^[A-Za-z]{3}$/.test(c)) return Response.json({ error: "invalid_request" }, { status: 400 });
  try { return Response.json(await deleteExchangeRate(getDb(), user, c)); } catch (err) { return toResponse(err); }
}
