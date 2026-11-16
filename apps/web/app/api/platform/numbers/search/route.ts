import { assertAuthorized } from "@voiceai/auth";
import { z } from "zod";
import { toResponse } from "@/lib/api-errors";
import { getPlivo } from "@/lib/providers";
import { requireUser } from "@/lib/server";

const querySchema = z.object({
  country: z.string().regex(/^[A-Za-z]{2}$/),
  type: z.enum(["local", "tollfree", "mobile", "national", "fixed"]).optional(),
  pattern: z.string().max(20).optional(), city: z.string().max(80).optional(), region: z.string().max(80).optional(),
  services: z.enum(["voice", "sms", "voice,sms"]).optional(),
  limit: z.coerce.number().int().min(1).max(20).default(20), offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

/** Platform staff can search live Plivo inventory. This is read-only; it does not rent a number. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    assertAuthorized(user, "platform.admin");
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
    if (!parsed.success) return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
    const q = parsed.data;
    return Response.json(await getPlivo().searchNumbers({ countryIso: q.country, type: q.type, pattern: q.pattern, city: q.city, region: q.region, services: q.services, limit: q.limit, offset: q.offset }));
  } catch (err) { return toResponse(err); }
}
