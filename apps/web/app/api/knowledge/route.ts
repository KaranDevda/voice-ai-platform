import { z } from "zod";
import { ingestKnowledge } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const MAX_CHARS = 200_000;
const json = z.object({ title: z.string().trim().min(1).max(200), text: z.string().trim().min(1).max(MAX_CHARS), sourceUrl: z.string().url().optional() });

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
      if (!(file instanceof File) || !/\.(txt|md|markdown|csv)$/i.test(file.name)) return Response.json({ error: "invalid_request", message: "Upload a .txt, .md or .csv file, or paste the text" }, { status: 400 });
      input = json.parse({ title, text: await file.text() });
    } else {
      input = json.parse(await req.json().catch(() => null));
    }
    return Response.json(await ingestKnowledge(getDb(), user, input), { status: 201 });
  } catch (err) {
    return toResponse(err);
  }
}
