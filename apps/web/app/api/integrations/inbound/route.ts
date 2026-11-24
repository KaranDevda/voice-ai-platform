import { z } from "zod";
import { syncContactsFromCrm } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const contact = z.object({
  phone: z.string().min(3).max(30),
  name: z.string().max(200).nullish(),
  email: z.string().max(320).nullish(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  status: z.string().max(40).nullish(),
  externalId: z.union([z.string().max(100), z.number()]).nullish().transform((v) => (v == null ? v : String(v))),
  fields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});

/**
 * Two-way CRM sync, the incoming half: the CRM sends contacts here with an API token that has leads.write
 * (Account > API tokens), and they are created or updated by phone number. Up to 500 per request.
 *   POST /api/integrations/inbound   Authorization: Bearer va_...   {"contacts":[{"phone":"+919812345678","name":"Priya","status":"interested","externalId":"crm-42"}]}
 */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = z.object({ contacts: z.array(contact).min(1).max(500) }).safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "invalid_request", message: "send {\"contacts\": [{\"phone\": \"+91...\", ...}]} with 1 to 500 contacts", issues: b.error.issues.slice(0, 5) }, { status: 400 });
  try { return Response.json(await syncContactsFromCrm(getDb(), user, b.data.contacts)); } catch (err) { return toResponse(err); }
}
