import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { signVoiceId, voicesDir } from "@/lib/providers";

const NAME = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.(?:hi))?)\.safetensors$/i;

/**
 * Serves a stored clone voice file to the self-hosted TTS server only. A voice file is biometric data, so the
 * address carries a signature and the route answers 404 for anything wrong. The address ends in .safetensors
 * because the TTS server picks the file type from it. Keep the TTS server on a private network.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ sig: string; name: string }> }) {
  const { sig, name } = await params;
  const m = NAME.exec(name);
  if (!m) return new Response("not found", { status: 404 });
  const stem = m[1]!; // the voice id, plus ".hi" for the Hindi file
  const want = Buffer.from(signVoiceId(stem)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return new Response("not found", { status: 404 });
  try {
    const file = await readFile(join(voicesDir(), `${stem}.safetensors`));
    return new Response(new Uint8Array(file), { headers: { "content-type": "application/octet-stream", "cache-control": "private, no-store" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
