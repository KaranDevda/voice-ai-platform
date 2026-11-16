import "server-only";
import type { AuthUser } from "@voiceai/auth";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { listSelectableVoices } from "@voiceai/db";
import { voiceFileStem } from "@voiceai/providers";
import { getDb } from "./server";
import { builtInHindi, hasFingerprint, hindiConversionOn, stockVoiceOptions, voicesDir, type VoiceOption } from "./providers";

/** Cloned (consented, active) voices first, then the stock catalogue. Provider voice ids are never included. */
export async function voiceOptionsFor(user: AuthUser): Promise<VoiceOption[]> {
  const cloned = (await listSelectableVoices(getDb(), user.orgId)).map<VoiceOption>((v) => {
    const kokoro = builtInHindi();
    const hasHindiVoice = v.provider === "pocket_tts" && existsSync(join(voicesDir(), `${voiceFileStem(v.providerVoiceId, "hi")}.safetensors`));
    return {
      ref: `profile:${v.id}`, name: v.label, gender: v.gender, group: "cloned", provider: v.provider,
      hindiOwn: v.provider === "pocket_tts" && (kokoro ? hindiConversionOn() && hasFingerprint(v.providerVoiceId) : hasHindiVoice),
      detail: v.providerVoiceId.startsWith("demo-voice-") ? "Demo voice (no real clone)" : "Cloned staff voice",
      // A self-hosted clone speaks Hindi only if it has its own Hindi voice file; ElevenLabs voices are multilingual.
      hindi: v.provider === "pocket_tts" ? kokoro || hasHindiVoice : v.provider === "elevenlabs",
    };
  });
  return [...cloned, ...stockVoiceOptions()];
}
