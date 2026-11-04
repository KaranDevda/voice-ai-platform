import { z } from "zod";
import { assertConsentUsable, createVoiceProfile, saveVoiceSample } from "@voiceai/db";
import { assertAuthorized } from "@voiceai/auth";
import { cloneProvider, getElevenLabs, getPocketTts, timed } from "@/lib/providers";
import { getDb } from "@/lib/server";
import { studioRoute } from "@/lib/studio-route";

const MAX_SAMPLE = 10 * 1024 * 1024;
const fields = z.object({ label: z.string().trim().min(1).max(80), gender: z.enum(["male", "female"]), donorUserId: z.string().uuid(), consentRecordId: z.string().uuid() });

export const POST = (req: Request) =>
  studioRoute({ mutation: true }, async (user) => {
    assertAuthorized(user, "voice_profiles.manage");
    const form = await req.formData().catch(() => null);
    if (!form) return Response.json({ error: "invalid_request" }, { status: 400 });
    const input = fields.parse(Object.fromEntries(["label", "gender", "donorUserId", "consentRecordId"].map((k) => [k, form.get(k)])));
    const files = form.getAll("samples").filter((f): f is File => f instanceof File && f.size > 0);
    const hindiFile = form.get("samplesHindi");
    const hindi = hindiFile instanceof File && hindiFile.size > 0 ? hindiFile : null;
    if (!files.length) return Response.json({ error: "invalid_request", message: "at least one voice sample is required" }, { status: 400 });
    if (files.some((f) => f.size > MAX_SAMPLE) || (hindi && hindi.size > MAX_SAMPLE)) return Response.json({ error: "file_too_large", message: "Each sample must be 10 MB or smaller" }, { status: 413 });

    // No clone is ever created without a valid, unused consent for this exact donor.
    await assertConsentUsable(getDb(), user, input.donorUserId, input.consentRecordId);

    const provider = cloneProvider();
    const engine = provider === "pocket_tts" ? getPocketTts() : getElevenLabs();
    const samples = await Promise.all(files.map(async (f) => ({ name: f.name || "sample.webm", mime: f.type || "audio/webm", data: new Uint8Array(await f.arrayBuffer()) })));
    const asSample = async (f: File) => ({ name: f.name || "sample.wav", mime: f.type || "audio/wav", data: new Uint8Array(await f.arrayBuffer()) });
    const hindiSample = hindi && provider === "pocket_tts" ? await asSample(hindi) : undefined;
    const cloned = await timed(user, provider, "clone", () => (provider === "pocket_tts" ? getPocketTts().cloneVoice({ label: input.label, samples, hindiSample }) : engine.cloneVoice({ label: input.label, samples })));
    const { providerVoiceId } = cloned;
    // Only the self-hosted engine reports which languages it made voice files for.
    const extra = cloned as { languages?: string[]; failed?: { language: string }[]; hindiInOwnVoice?: boolean };
    // With the built-in Hindi voice every voice also speaks Hindi and Hinglish; no Hindi voice file is made.
    const languages = extra.languages && process.env.KOKORO_URL?.trim() && !extra.languages.includes("hi") ? [...extra.languages, "hi"] : extra.languages;
    const failed = extra.failed?.map((f) => f.language);
    let profile;
    try {
      profile = await createVoiceProfile(getDb(), user, { ...input, provider, providerVoiceId });
    } catch (err) {
      // Do not leave an orphan clone at the provider if registering it here failed.
      await engine.deleteVoice(providerVoiceId).catch(() => {});
      throw err;
    }
    // The recording is kept with the voice (biometric data, managers only, deleted with the voice) so the voice can be heard on the
    // website, re-made, and used by the open-source Chatterbox engine. A Hindi-specific recording wins when one was given.
    // The voice is already registered at this point, so a failure here must never delete its voice files: it is reported instead.
    let sampleSaved = false;
    const kept = hindiSample ?? samples[0]!;
    if (provider === "pocket_tts" && kept.data.length) {
      sampleSaved = await saveVoiceSample(getDb(), user, profile.id, kept.data, "audio/wav").then(() => true, (e) => { console.error("could not keep the voice recording", e); return false; });
    }
    // Raw samples were otherwise only held in memory for this request.
    return Response.json({ id: profile.id, label: profile.label, languages, missingLanguages: failed, hindiInOwnVoice: extra.hindiInOwnVoice ?? false, recordingKept: sampleSaved }, { status: 201 });
  });
