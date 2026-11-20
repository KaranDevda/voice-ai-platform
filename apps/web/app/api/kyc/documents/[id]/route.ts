import { z } from "zod";
import { getKycDocument } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { getDb, requireUser } from "@/lib/server";

/** Opens an identity document: staff at the platform any of them, an organisation only its own. Always downloaded, never run in the page. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const doc = await getKycDocument(getDb(), user, id.data);
    if (!doc) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(new Uint8Array(doc.data), { headers: {
      "content-type": doc.mime,
      "content-disposition": `attachment; filename="${doc.fileName.replace(/[^\w.-]/g, "_")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    } });
  } catch (err) { return toResponse(err); }
}
