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
    if (req.headers.get("accept")?.includes("application/x-ndjson")) {
      const encoder = new TextEncoder();
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const emit = (event: unknown) => { if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); };
          void importContacts(getDb(), user, input, (progress) => {
            if (cancelled) throw new Error("The client cancelled the import");
            emit({ type: "progress", ...progress });
          }).then((result) => {
            emit({ type: "done", result });
            if (!cancelled) controller.close();
          }).catch(async (err) => {
            try {
              const response = toResponse(err);
              const body = await response.json().catch(() => ({}));
              emit({ type: "error", message: body.message ?? body.error ?? "Could not import contacts" });
            } catch { emit({ type: "error", message: "Could not import contacts" }); }
            if (!cancelled) controller.close();
          });
        },
        cancel() { cancelled = true; },
      });
      return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }
    return Response.json(await importContacts(getDb(), user, input), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
}
