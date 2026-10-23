import { z } from "zod";
import { assertConsentUsable, createVoiceProfile } from "@voiceai/db";
import { assertAuthorized } from "@voiceai/auth";
import { getElevenLabs, timed } from "@/lib/providers";
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
    if (!files.length) return Response.json({ error: "invalid_request", message: "at least one voice sample is required" }, { status: 400 });
    if (files.some((f) => f.size > MAX_SAMPLE)) return Response.json({ error: "file_too_large", message: "Each sample must be 10 MB or smaller" }, { status: 413 });

    // No clone is ever created without a valid, unused consent for this exact donor.
    await assertConsentUsable(getDb(), user, input.donorUserId, input.consentRecordId);

    const eleven = getElevenLabs();
    const samples = await Promise.all(files.map(async (f) => ({ name: f.name || "sample.webm", mime: f.type || "audio/webm", data: new Uint8Array(await f.arrayBuffer()) })));
    const { providerVoiceId } = await timed(user, "elevenlabs", "clone", () => eleven.cloneVoice({ label: input.label, samples }));
    try {
      const profile = await createVoiceProfile(getDb(), user, { ...input, provider: "elevenlabs", providerVoiceId });
      // Raw samples were only held in memory for this request (SOP: raw samples deleted after cloning).
      return Response.json({ id: profile.id, label: profile.label }, { status: 201 });
    } catch (err) {
      // Do not leave an orphan clone at the provider if registering it here failed.
      await eleven.deleteVoice(providerVoiceId).catch(() => {});
      throw err;
    }
  });
