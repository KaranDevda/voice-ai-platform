/**
 * Compares speech-to-text providers on the same spoken sentences: character error rate (lower is better) and time to answer.
 *   pnpm --filter @voiceai/voice exec tsx src/stt-compare.ts [--speaker hf_alpha] [--out file.json]
 * The sentences are spoken by the local Hindi voice (Kokoro), so this is a repeatable first comparison, NOT a substitute for real callers:
 * synthetic speech is cleaner than a phone line. Re-run it on recordings of real calls before choosing a provider.
 */
import { spellOutHindiNumbers } from "@voiceai/shared";
try { process.loadEnvFile(".env.local"); } catch { /* optional */ }
const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d; };
const KOKORO = process.env.KOKORO_URL ?? "http://127.0.0.1:8768", SPEAKER = arg("speaker", "hf_alpha");
const WHISPER = process.env.WHISPER_URL ?? "http://127.0.0.1:8767";

// [spoken text, what a correct transcript contains]. Numbers are written in words so every provider is scored the same way.
const SENTENCES = [
  "नमस्ते, मुझे आपके बिज़नेस प्लान के बारे में जानना है।",
  "मेरा नाम रोहन मेहता है और मैं मुंबई से बोल रहा हूँ।",
  "क्या आप कॉल रिकॉर्ड करते हैं और डेटा कहाँ रखते हैं?",
  "प्लान की कीमत चार हज़ार नौ सौ निन्यानवे रुपये प्रति माह है।",
  "मेरा नंबर नौ आठ सात छह पाँच चार तीन दो एक शून्य है।",
  "क्या इस हफ़्ते शुक्रवार को डेमो मिल सकता है?",
  "मुझे अपना अकाउंट अपग्रेड करना है, कृपया पेमेंट लिंक भेज दीजिए।",
  "आपकी सपोर्ट टीम कब तक उपलब्ध रहती है?",
  "सुनीता शर्मा जी से बात करवा दीजिए, वो हमारी मैनेजर हैं।",
  "ठीक है, मैं कल सुबह दस बजे दोबारा कॉल करता हूँ।",
];

const clean = (s: string) => spellOutHindiNumbers(s).replace(/[।.,?!'"₹-]/g, "").replace(/\s+/g, "").toLowerCase();
function cer(ref: string, hyp: string) {
  const a = [...clean(ref)], b = [...clean(hyp)];
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]! / Math.max(1, a.length);
}

async function speak(text: string): Promise<Uint8Array> {
  const r = await fetch(`${KOKORO}/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: SPEAKER, lang: "hi" }) });
  if (!r.ok) throw new Error(`Kokoro ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

type Provider = { name: string; run: (wav: Uint8Array) => Promise<string> };
const providers: Provider[] = [];
providers.push({ name: "whisper (local, small)", run: async (wav) => {
  const f = new FormData(); f.set("file", new Blob([wav as unknown as BlobPart], { type: "audio/wav" }), "a.wav"); f.set("language", "hi"); f.set("response_format", "json"); f.set("temperature", "0.0");
  const r = await fetch(`${WHISPER}/inference`, { method: "POST", body: f }); return ((await r.json()) as { text?: string }).text ?? "";
} });
if (process.env.SARVAM_API_KEY) providers.push({ name: "sarvam saarika:v2.5", run: async (wav) => {
  const f = new FormData(); f.set("file", new Blob([wav as unknown as BlobPart], { type: "audio/wav" }), "a.wav"); f.set("model", "saarika:v2.5"); f.set("language_code", "hi-IN");
  const r = await fetch("https://api.sarvam.ai/speech-to-text", { method: "POST", headers: { "api-subscription-key": process.env.SARVAM_API_KEY! }, body: f }); return ((await r.json()) as { transcript?: string }).transcript ?? "";
} });
if (process.env.DEEPGRAM_API_KEY) providers.push({ name: "deepgram nova-3", run: async (wav) => {
  const r = await fetch("https://api.deepgram.com/v1/listen?model=nova-3&language=hi&smart_format=false", { method: "POST", headers: { authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "content-type": "audio/wav" }, body: wav as unknown as BodyInit });
  return ((await r.json()) as { results?: { channels?: { alternatives?: { transcript?: string }[] }[] } }).results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
} });

const results: Record<string, { cer: number[]; ms: number[]; misses: string[] }> = {};
const wavs = await Promise.all(SENTENCES.map(speak));
for (const p of providers) {
  results[p.name] = { cer: [], ms: [], misses: [] };
  for (let i = 0; i < SENTENCES.length; i++) {
    const t0 = performance.now();
    const hyp = await p.run(wavs[i]!).catch((e) => `ERROR ${e}`);
    const ms = performance.now() - t0, c = cer(SENTENCES[i]!, hyp);
    results[p.name]!.cer.push(c); results[p.name]!.ms.push(ms);
    if (c > 0.15) results[p.name]!.misses.push(`  [${(c * 100).toFixed(0)}%] said "${SENTENCES[i]}"\n         heard "${hyp}"`);
  }
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]!;
console.log(`\n${SENTENCES.length} Hindi/Hinglish sentences, spoken by Kokoro ${SPEAKER}\n`);
console.log("provider".padEnd(26) + "char error rate".padEnd(18) + "time p50".padEnd(11) + "time p95");
for (const [name, r] of Object.entries(results)) console.log(name.padEnd(26) + `${((r.cer.reduce((a, b) => a + b, 0) / r.cer.length) * 100).toFixed(1)}%`.padEnd(18) + `${(pct(r.ms, 50) / 1000).toFixed(2)} s`.padEnd(11) + `${(pct(r.ms, 95) / 1000).toFixed(2)} s`);
for (const [name, r] of Object.entries(results)) if (r.misses.length) console.log(`\n${name}: sentences with more than 15% errors\n${r.misses.join("\n")}`);
if (arg("out", "")) (await import("node:fs")).writeFileSync(arg("out", ""), JSON.stringify(results, null, 1));
