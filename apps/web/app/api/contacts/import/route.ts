import { z } from "zod";
import { importContacts } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const json = z.object({ text: z.string().min(1).max(2_000_000), tags: z.array(z.string().max(30)).max(10).default([]) });

/** Adds a contact list (CSV) as leads. Send the file as multipart ("file", optional "tags") or JSON { text, tags }. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    let input: z.infer<typeof json>;
    if (req.headers.get("content-type")?.startsWith("multipart/")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File) || !/\.(csv|txt|tsv)$/i.test(file.name)) return Response.json({ error: "invalid_request", message: "Upload a .csv file, or paste the rows" }, { status: 400 });
      input = json.parse({ text: await file.text(), tags: String(form.get("tags") ?? "").split(/[,;|]/).map((t) => t.trim()).filter(Boolean) });
    } else {
      input = json.parse(await req.json().catch(() => null));
    }
    return Response.json(await importContacts(getDb(), user, input), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
}
