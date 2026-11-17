import { z } from "zod";
import { ingestKnowledge } from "@voiceai/db";
import { chunkText, htmlToKnowledgeText } from "@voiceai/shared";
import { embeddingsFromEnv } from "@voiceai/providers";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";
import { importKnowledgeUrl } from "@/lib/knowledge-url";

const MAX_CHARS = 200_000;
const json = z.object({ title: z.string().trim().min(1).max(200).optional(), text: z.string().trim().min(1).max(MAX_CHARS).optional(), sourceUrl: z.string().url().optional() });
const completeInput = z.object({ title: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(MAX_CHARS), sourceUrl: z.string().url().optional() });

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    let input: z.infer<typeof json>;
    if (req.headers.get("content-type")?.startsWith("multipart/")) {
      const form = await req.formData();
      const file = form.get("file");
      const title = String(form.get("title") ?? (file instanceof File ? file.name.replace(/\.[^.]+$/, "") : ""));
      if (!(file instanceof File) || !/\.(txt|md|markdown|csv|html|htm)$/i.test(file.name) || file.size > 1_000_000) return Response.json({ error: "invalid_request", message: "Upload a .txt, .md, .csv or HTML file up to 1 MB, or paste the text" }, { status: 400 });
      const raw = await file.text();
      const text = /\.(html|htm)$/i.test(file.name) ? htmlToKnowledgeText(raw) : raw;
      input = json.parse({ title, text });
    } else {
      input = json.parse(await req.json().catch(() => null));
    }
    if (input.sourceUrl) {
      if (input.text) return Response.json({ error: "invalid_request", message: "Send either text or a source URL" }, { status: 400 });
      let imported: Awaited<ReturnType<typeof importKnowledgeUrl>>;
      try {
        imported = await importKnowledgeUrl(input.sourceUrl);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not import that website.";
        return Response.json({ error: "source_import_failed", message }, { status: 422 });
      }
      input = json.parse({ title: input.title || imported.title, text: imported.text, sourceUrl: imported.url });
    }
    const complete = completeInput.parse(input);
    const chunks = chunkText(complete.text);
    const embeddingProvider = embeddingsFromEnv();
    const embeddings = embeddingProvider ? await embeddingProvider.embed(chunks) : undefined;
    return Response.json(await ingestKnowledge(getDb(), user, complete, embeddings), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
}
