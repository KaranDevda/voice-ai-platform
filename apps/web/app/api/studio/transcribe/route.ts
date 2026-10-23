import { saveAsset } from "@voiceai/db";
import { z } from "zod";
import { getStt, timed } from "@/lib/providers";
import { getDb } from "@/lib/server";
import { studioRoute } from "@/lib/studio-route";

const MAX_BYTES = 25 * 1024 * 1024;
const opts = z.object({ language: z.enum(["auto", "en", "hi", "multi"]).default("auto"), diarize: z.enum(["true", "false"]).default("true"), save: z.enum(["true", "false"]).default("false"), title: z.string().max(200).optional() });

export const POST = (req: Request) =>
  studioRoute({ mutation: true }, async (user) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File) || file.size === 0) return Response.json({ error: "invalid_request", message: "an audio file is required" }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ error: "file_too_large", message: "Audio must be 25 MB or smaller" }, { status: 413 });
    const o = opts.parse(Object.fromEntries(["language", "diarize", "save", "title"].flatMap((k) => (form!.get(k) ? [[k, String(form!.get(k))]] : []))));

    const audio = new Uint8Array(await file.arrayBuffer());
    const mime = file.type || "application/octet-stream";
    const t0 = Date.now();
    const result = await timed(user, "deepgram", "transcription", () => getStt().transcribe({ audio, mime, language: o.language, diarize: o.diarize === "true", signal: AbortSignal.timeout(60_000) }), (r) => r.durationS);

    let assetId: string | null = null;
    if (o.save === "true") {
      const saved = await saveAsset(getDb(), user, {
        kind: "transcript", title: o.title?.trim() || file.name || "Transcript", text: result.text, provider: "deepgram", mime, audio,
        durationMs: Math.round(result.durationS * 1000), meta: { segments: result.segments, language: result.language },
      });
      assetId = saved.id;
    }
    return Response.json({ ...result, assetId, latencyMs: Date.now() - t0 });
  });
