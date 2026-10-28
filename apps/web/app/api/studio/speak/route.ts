import { z } from "zod";
import { saveAsset } from "@voiceai/db";
import { spellOutHindiNumbers } from "@voiceai/shared";
import { builtInHindi, resolveVoice, timed } from "@/lib/providers";
import { getDb } from "@/lib/server";
import { studioRoute } from "@/lib/studio-route";

const MAX_CHARS = 10_000;
/** Hindi in a cloned voice is made sentence by sentence (about 3 s each), so a long text needs more than a fixed minute. */
const speakTimeoutMs = (chars: number) => Math.min(600_000, 60_000 + chars * 150);
const body = z.object({ text: z.string().trim().min(1).max(MAX_CHARS), voice: z.string().min(1), save: z.boolean().default(false), title: z.string().max(200).optional() });

export const POST = (req: Request) =>
  studioRoute({ mutation: true }, async (user) => {
    const input = body.parse(await req.json().catch(() => null));
    const { speak, voiceId, provider, hindiVoice } = await resolveVoice(user, input.voice);
    const t0 = Date.now();
    const result = await timed(user, provider, "speech", () => speak.speak({ text: spellOutHindiNumbers(input.text), voiceId, hindiVoice, format: "mp3", signal: AbortSignal.timeout(speakTimeoutMs(input.text.length)) }), () => input.text.length);

    // Be plain about who is speaking, from what actually happened (a conversion that failed falls back to the built-in voice).
    const gender = hindiVoice?.startsWith("hm_") ? "male" : "female";
    const voiceNote = result.hindiVoice === "converted"
      ? "Hindi and Hinglish parts were changed into this person's own voice. English parts use the clone."
      : result.hindiVoice === "built-in" || (provider === "pocket_tts" && /[\u0900-\u097F]/.test(input.text) && builtInHindi())
        ? `Hindi and Hinglish parts are spoken by a built-in ${gender} Hindi voice, not this person's own voice. English parts use the clone. To use their own voice for Hindi, clone them again, or use Add Hindi to an existing voice.`
        : "";

    let assetId = "";
    if (input.save) {
      const saved = await saveAsset(getDb(), user, {
        kind: "speech", title: input.title?.trim() || input.text.slice(0, 60), text: input.text, provider, voiceRef: input.voice, mime: result.mime, audio: result.audio,
      });
      assetId = saved.id;
    }
    return new Response(result.audio as unknown as BodyInit, {
      headers: { "content-type": result.mime, "cache-control": "private, no-store", "x-asset-id": assetId, "x-latency-ms": String(Date.now() - t0), "x-voice-note": encodeURIComponent(voiceNote), "x-chars": String(input.text.length) },
    });
  });
