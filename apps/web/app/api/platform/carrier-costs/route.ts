import { z } from "zod";
import { deleteCarrierCost, listCarrierCosts, saveCarrierCost, setDefaultMargin } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({ country: z.string().length(2), callCostPerMinPaise: z.number().int().min(0).max(100_000), smsCostPaise: z.number().int().min(0).max(100_000), marginPct: z.number().min(0).max(1000) });
const defaultMargin = z.object({ defaultMarginPct: z.number().min(0).max(1000) });

/** Platform staff: carrier cost and profit margin per country (selling price = cost plus margin). */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { return Response.json(await listCarrierCosts(getDb(), user)); } catch (err) { return toResponse(err); }
}
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const json = await req.json().catch(() => null);
    if (json && typeof json === "object" && "defaultMarginPct" in json) return Response.json({ defaultMarginPct: await setDefaultMargin(getDb(), user, defaultMargin.parse(json).defaultMarginPct) });
    return Response.json(await saveCarrierCost(getDb(), user, body.parse(json)));
  } catch (err) { return toResponse(err); }
}
export async function DELETE(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try { await deleteCarrierCost(getDb(), user, new URL(req.url).searchParams.get("country") ?? ""); return Response.json({ ok: true }); } catch (err) { return toResponse(err); }
}
