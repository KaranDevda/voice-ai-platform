import { z } from "zod";
import { assertAuthorized } from "@voiceai/auth";
import { addVoiceLanguage } from "@voiceai/db";
import { getPocketTts, timed } from "@/lib/providers";
import { getDb } from "@/lib/server";
import { studioRoute } from "@/lib/studio-route";

const MAX_SAMPLE = 10 * 1024 * 1024;
const fields = z.object({ language: z.enum(["hi"]) });

/** Adds a language to an existing cloned voice from a fresh WAV recording of the same person. */
export const POST = (req: Request, { params }: { params: Promise<{ id: string }> }) =>
  studioRoute({ mutation: true }, async (user) => {
    assertAuthorized(user, "voice_profiles.manage");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "invalid_request" }, { status: 400 });
    const form = await req.formData().catch(() => null);
    const file = form?.get("sample");
    if (!form || !(file instanceof File) || !file.size) return Response.json({ error: "invalid_request", message: "a voice sample is required" }, { status: 400 });
    if (file.size > MAX_SAMPLE) return Response.json({ error: "file_too_large", message: "The sample must be 10 MB or smaller" }, { status: 413 });
    const { language } = fields.parse({ language: form.get("language") });

    const pocket = getPocketTts();
    const data = new Uint8Array(await file.arrayBuffer());
    await addVoiceLanguage(getDb(), user, id, language, async (profile) => {
      if (profile.provider !== "pocket_tts") throw new RangeError("Only voices made with the free voice engine can get another language.");
      await timed(user, "pocket_tts", "add_language", () => pocket.addLanguage({ providerVoiceId: profile.providerVoiceId, language, sample: { name: "sample.wav", mime: "audio/wav", data } }));
    });
    return Response.json({ ok: true, language });
  });
