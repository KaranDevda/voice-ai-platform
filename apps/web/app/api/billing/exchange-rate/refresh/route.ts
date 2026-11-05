import { refreshExchangeRates } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** Platform staff: sets the exchange rates from today's market rates. Rates that move more than 25 percent at once are skipped and listed. */
export async function POST() {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await refreshExchangeRates(getDb(), user)); } catch (err) { return toResponse(err); }
}
