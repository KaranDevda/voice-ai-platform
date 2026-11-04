/**
 * How long after a caller starts talking over the AI does the voice detector fire (this is what stops the AI's voice)?
 *   pnpm --filter @voiceai/voice exec tsx src/barge-in-latency.ts
 * Measured on real speech (made by the local Hindi voice) that starts after silence, for the two start settings the service uses.
 * It covers our detector only. The phone carrier's own audio queue (Plivo "clear") adds its own delay, which needs real calls.
 */
import { Vad } from "@voiceai/providers";
try { process.loadEnvFile(".env.local"); } catch { /* optional */ }
const KOKORO = process.env.KOKORO_URL ?? "http://127.0.0.1:8768";
const r = await fetch(`${KOKORO}/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "नहीं नहीं, रुकिए, मुझे कुछ और पूछना है।", voice: "hf_alpha", lang: "hi" }) });
const wav = Buffer.from(await r.arrayBuffer()), rate = wav.readUInt32LE(24);
const src = new Int16Array(wav.buffer.slice(wav.byteOffset + 44, wav.byteOffset + wav.length - ((wav.length - 44) & 1)));
const pcm = new Int16Array(Math.floor((src.length * 16000) / rate)); for (let i = 0; i < pcm.length; i++) pcm[i] = src[Math.floor((i * rate) / 16000)]!;
const first = pcm.findIndex((x) => Math.abs(x) > 1500); // where the speech really begins
for (const [label, opts] of [["anyone / push (startMs 100)", {}], ["close mic (startMs 200)", { startMs: 200, floor: 0.03, minSpeechMs: 400 }]] as const) {
  const ms: number[] = [];
  for (let offset = 0; offset < 640; offset += 80) { // the speech can begin anywhere inside a 20 ms frame; try several silence lengths
    const vad = new Vad({ sampleRate: 16000, ...opts });
    const audio = new Int16Array(16000 + offset * 16 + pcm.length - first); audio.set(pcm.subarray(first), 16000 + offset * 16);
    const onset = 16000 + offset * 16; let fired = -1;
    for (let o = 0; o < audio.length && fired < 0; o += 320) if (vad.push(audio.subarray(o, o + 320)).some((e) => e.kind === "start")) fired = o + 320;
    ms.push(((fired - onset) / 16000) * 1000);
  }
  console.log(`${label.padEnd(30)} detector fires ${Math.min(...ms).toFixed(0)}–${Math.max(...ms).toFixed(0)} ms after the speech begins`);
}
