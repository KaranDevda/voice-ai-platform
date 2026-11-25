import { z } from "zod";
import { saveAsset } from "@voiceai/db";
import { hasEmotionTags, parseEmotionScript, speakableNumbers, spellOutHindiNumbers, stripEmotionTags } from "@voiceai/shared";
import { applyProsodyToWav, clampProsody, speakPaced, speakStyled, tidyWavEnds } from "@voiceai/providers";
import { builtInHindi, resolveVoice, timed } from "@/lib/providers";
import { getDb } from "@/lib/server";
import { studioRoute } from "@/lib/studio-route";

const MAX_CHARS = 10_000;
/** Hindi in a cloned voice is made sentence by sentence (about 3 s each), so a long text needs more than a fixed minute. */
const speakTimeoutMs = (chars: number) => Math.min(900_000, 60_000 + chars * 400);
const body = z.object({ text: z.string().trim().min(1).max(MAX_CHARS), voice: z.string().min(1), save: z.boolean().default(false), title: z.string().max(200).optional(),
  /** Try other settings without saving them (the preview on the voices page). Without these, the voice's saved speed and pitch are used. */
  /** "natural" (default): each sentence is spoken on its own with human-length pauses between them, so it does not read like one even advert. "off": the engine's own pacing. */
  pacing: z.enum(["natural", "off"]).default("natural"),
  /** A cloned voice made by Chatterbox: more natural, but roughly 30 seconds for a sentence. */
  highQuality: z.boolean().default(false),
  speed: z.number().min(0.8).max(1.25).optional(), pitch: z.number().min(-3).max(3).optional() });

export const POST = (req: Request) =>
  studioRoute({ mutation: true }, async (user) => {
    const input = body.parse(await req.json().catch(() => null));
    const { speak, voiceId, provider, hindiVoice, prosody } = await resolveVoice(user, input.voice, { highQuality: input.highQuality });
    const t0 = Date.now();
    const spoken = (t: string) => spellOutHindiNumbers(speakableNumbers(t));
    const tagged = hasEmotionTags(input.text);
    const args = { text: spoken(stripEmotionTags(input.text)), voiceId, hindiVoice, format: "mp3" as const, signal: AbortSignal.timeout(speakTimeoutMs(input.text.length)) };
    // Cloned voices carry their own speed and pitch; the preview can override them. Other audio (mp3 from ElevenLabs) is left as it is.
    const shaping = clampProsody({ speed: input.speed ?? prosody?.speed, pitch: input.pitch ?? prosody?.pitch });
    // Emotion tags like [excited] change speed, pitch and pauses per part; they are applied while the parts are joined.
    const segments = tagged ? parseEmotionScript(input.text).map((s) => ({ ...s, text: spoken(s.text) })) : [];
    const made = await timed(user, provider, "speech", () => segments.length ? speakStyled(speak, { voiceId, hindiVoice, signal: args.signal }, segments, shaping) : provider === "chatterbox" || provider === "maya2" || input.pacing === "off" ? speak.speak(args) : speakPaced(speak, args), () => input.text.length);
    const result = made.mime !== "audio/wav" ? made
      : segments.length ? made // already cleaned and shaped piece by piece
      : { ...made, audio: tidyWavEnds(applyProsodyToWav(made.audio, shaping)) };

    // Be plain about who is speaking, from what actually happened (a conversion that failed falls back to the built-in voice).
    const gender = hindiVoice?.startsWith("hm_") ? "male" : "female";
    const voiceNote = result.engine === "maya2" ? "Made directly in this person's own voice (Maya 2)."
      : result.engine === "chatterbox" ? "Made directly in this person's own voice (Chatterbox)."
      : result.engine === "fallback" ? (result.note ?? "The GPU voice engine could not be used, so the built-in voice engine spoke.")
      : result.hindiVoice === "converted"
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
