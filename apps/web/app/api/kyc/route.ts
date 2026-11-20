import { z } from "zod";
import { submitKyc, type KycDocument } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const MAX_FILE = 2 * 1024 * 1024;
const fields = z.object({ tier: z.enum(["basic", "business"]), legalName: z.string().max(120), pan: z.string().max(10), gstin: z.string().max(15).optional(), contactName: z.string().max(80), contactPhone: z.string().max(20), address: z.string().max(300) });

/** Asks to be verified, with the PAN card (and, for a business, the GST certificate) attached. A person at the platform reviews it. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const form = await req.formData().catch(() => null);
    if (!form) return Response.json({ error: "invalid_request" }, { status: 400 });
    const text = (k: string) => { const v = form.get(k); return typeof v === "string" ? v : undefined; };
    const input = fields.parse({ tier: text("tier"), legalName: text("legalName"), pan: text("pan"), gstin: text("gstin") || undefined, contactName: text("contactName"), contactPhone: text("contactPhone"), address: text("address") });
    const documents: KycDocument[] = [];
    for (const [field, kind] of [["panDoc", "pan"], ["gstDoc", "gst"]] as const) {
      const f = form.get(field);
      if (!(f instanceof File) || f.size === 0) continue;
      if (f.size > MAX_FILE) return Response.json({ error: "admin", message: "each document must be 2 MB or smaller" }, { status: 409 });
      documents.push({ kind, fileName: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    }
    return Response.json(await submitKyc(getDb(), user, { ...input, documents }), { status: 201 });
  } catch (err) { return toResponse(err); }
}
