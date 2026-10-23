import { z } from "zod";
import { saveAsset } from "@voiceai/db";
import { resolveVoice, timed } from "@/lib/providers";
import { getDb } from "@/lib/server";
import { studioRoute } from "@/lib/studio-route";

const MAX_CHARS = 10_000;
const body = z.object({ text: z.string().trim().min(1).max(MAX_CHARS), voice: z.string().min(1), save: z.boolean().default(false), title: z.string().max(200).optional() });

export const POST = (req: Request) =>
  studioRoute({ mutation: true }, async (user) => {
    const input = body.parse(await req.json().catch(() => null));
    const { speak, voiceId, provider } = await resolveVoice(user, input.voice);
    const t0 = Date.now();
    const result = await timed(user, provider, "speech", () => speak.speak({ text: input.text, voiceId, format: "mp3", signal: AbortSignal.timeout(60_000) }), () => input.text.length);

    let assetId = "";
    if (input.save) {
      const saved = await saveAsset(getDb(), user, {
        kind: "speech", title: input.title?.trim() || input.text.slice(0, 60), text: input.text, provider, voiceRef: input.voice, mime: result.mime, audio: result.audio,
      });
      assetId = saved.id;
    }
    return new Response(result.audio as unknown as BodyInit, {
      headers: { "content-type": result.mime, "cache-control": "private, no-store", "x-asset-id": assetId, "x-latency-ms": String(Date.now() - t0), "x-chars": String(input.text.length) },
    });
  });
