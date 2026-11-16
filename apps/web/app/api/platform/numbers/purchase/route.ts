import { assertAuthorized } from "@voiceai/auth";
import { platformAddNumber, platformNumbers } from "@voiceai/db";
import { z } from "zod";
import { toResponse } from "@/lib/api-errors";
import { getPlivo } from "@/lib/providers";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({
  number: z.string().regex(/^\+?[1-9]\d{7,14}$/), countryIso: z.string().regex(/^[A-Za-z]{2}$/),
  type: z.enum(["local", "tollfree", "mobile", "national", "fixed"]),
  setupRate: z.string().max(20).nullable(), monthlyRentalRate: z.string().max(20).nullable(),
  complianceApplicationId: z.string().uuid().optional(), confirmed: z.literal(true),
});

/** Staff-only paid purchase. Cost and compliance data are reconfirmed against live Plivo search before renting. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    assertAuthorized(user, "platform.admin");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
    const i = parsed.data, normalized = i.number.replace(/^\+/, "");
    const inventory = await platformNumbers(getDb(), user);
    if (inventory.numbers.some((n) => n.e164 === `+${normalized}`)) return Response.json({ error: "number_already_in_inventory" }, { status: 409 });

    const plivo = getPlivo();
    const matches = await plivo.searchNumbers({ countryIso: i.countryIso, type: i.type, pattern: normalized, limit: 20 });
    const current = matches.find((n) => n.number.replace(/^\+/, "") === normalized);
    if (!current) return Response.json({ error: "number_no_longer_available" }, { status: 409 });
    if (current.setupRate !== i.setupRate || current.monthlyRentalRate !== i.monthlyRentalRate) {
      return Response.json({ error: "number_price_changed", current: { setupRate: current.setupRate, monthlyRentalRate: current.monthlyRentalRate } }, { status: 409 });
    }

    const result = await plivo.buyNumber({ number: normalized, complianceApplicationId: i.complianceApplicationId });
    const status = /success|fulfilled/i.test(result.status) ? "available" : "pending";
    try {
      await platformAddNumber(getDb(), user, {
        e164: result.number, label: `Plivo ${i.type}`, capabilities: [current.voiceEnabled ? "voice" : "", current.smsEnabled ? "sms" : ""].filter(Boolean), status,
      });
    } catch (err) {
      console.error("Plivo number purchase succeeded but inventory sync failed:", result.number, err instanceof Error ? err.message : err);
      return Response.json({ error: "inventory_sync_failed", number: result.number, carrierStatus: result.status }, { status: 502 });
    }
    return Response.json({ number: result.number, status, setupRate: current.setupRate, monthlyRentalRate: current.monthlyRentalRate }, { status: 201 });
  } catch (err) { return toResponse(err); }
}
