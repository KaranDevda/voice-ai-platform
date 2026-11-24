/**
 * Time to first audio for cloud voices that can speak one cloned voice in English, Hindi and Hinglish, measured from this machine
 * (so the network to India is included). It decides whether an alternative voice is fast enough to add: under 1 second, ideally
 * under 300 ms. Each provider runs only when its key is set:
 *   ELEVENLABS_API_KEY  (+ --el-voice <voice id>, default the first voice on the account; --el-model eleven_flash_v2_5)
 *   CARTESIA_API_KEY    (+ --cartesia-voice <voice id>; --cartesia-model and --cartesia-version as on Cartesia's docs page)
 *
 *   pnpm --filter @voiceai/voice exec tsx src/tts-compare.ts -- --runs 3
 *
 * ASSUMPTION for Cartesia: its documented REST call POST https://api.cartesia.ai/tts/bytes (X-API-Key, Cartesia-Version,
 * model_id, transcript, voice {mode: "id", id}, output_format raw pcm_s16le, language). Check the current model and version
 * strings on Cartesia's docs page and pass them with --cartesia-model / --cartesia-version.
 */
try { process.loadEnvFile(".env.local"); } catch { /* keys can also come from the real environment */ }
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback; };
const RUNS = Number(arg("runs", "3"));
const LINES: Array<[string, string, string]> = [
  ["en", "English", "The Business plan starts at 4,999 rupees per month, for up to 10 users."],
  ["hi", "Hindi", "जी, बिज़नेस प्लान चार हज़ार नौ सौ निन्यानवे रुपये महीने से शुरू होता है।"],
  ["hi", "Hinglish", "ठीक है करन जी, Tuesday 24 November, 4 PM। Team meeting link के साथ confirm करेगी।"],
];

async function firstByte(url: string, init: RequestInit): Promise<{ ms: number; total: number; bytes: number; status: number }> {
  const t0 = performance.now();
  const res = await fetch(url, init);
  if (!res.ok || !res.body) return { ms: -1, total: Math.round(performance.now() - t0), bytes: 0, status: res.status };
  const reader = res.body.getReader();
  let first = 0, bytes = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; if (!first) first = performance.now(); bytes += value.length; }
  return { ms: Math.round(first - t0), total: Math.round(performance.now() - t0), bytes, status: res.status };
}

const providers: Array<{ name: string; run: (text: string, lang: string) => ReturnType<typeof firstByte> }> = [];
const el = process.env.ELEVENLABS_API_KEY?.trim();
if (el) {
  let voice = arg("el-voice", "");
  if (!voice) voice = ((await (await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": el } })).json()) as { voices?: Array<{ voice_id: string }> }).voices?.[0]?.voice_id ?? "";
  const model = arg("el-model", "eleven_flash_v2_5");
  providers.push({ name: `ElevenLabs ${model}`, run: (text, lang) => firstByte(`https://api.elevenlabs.io/v1/text-to-speech/${voice}/stream?output_format=pcm_24000`, { method: "POST", headers: { "xi-api-key": el, "content-type": "application/json" }, body: JSON.stringify({ text, model_id: model, ...(lang === "hi" ? { language_code: "hi" } : {}) }) }) });
}
const ca = process.env.CARTESIA_API_KEY?.trim();
if (ca) {
  const voice = arg("cartesia-voice", ""), model = arg("cartesia-model", "sonic-3"), version = arg("cartesia-version", "2025-04-16");
  if (!voice) console.warn("CARTESIA_API_KEY is set but --cartesia-voice is missing: skipping Cartesia");
  else providers.push({ name: `Cartesia ${model}`, run: (text, lang) => firstByte("https://api.cartesia.ai/tts/bytes", { method: "POST", headers: { "X-API-Key": ca, "Cartesia-Version": version, "content-type": "application/json" }, body: JSON.stringify({ model_id: model, transcript: text, voice: { mode: "id", id: voice }, output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: 24000 }, language: lang }) }) });
}
if (!providers.length) { console.log("No provider key set (ELEVENLABS_API_KEY, CARTESIA_API_KEY): nothing to measure."); process.exit(0); }

for (const p of providers) for (const [lang, label, text] of LINES) {
  const firsts: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = await p.run(text, lang);
    if (r.ms < 0) { console.log(`${p.name} | ${label} | failed: HTTP ${r.status}`); break; }
    firsts.push(r.ms);
  }
  if (firsts.length) {
    const sorted = [...firsts].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    console.log(`${p.name} | ${label} | first audio ${firsts.join(", ")} ms (median ${median}) | ${median < 300 ? "excellent" : median < 1000 ? "under 1 s: fast enough" : "TOO SLOW (over 1 s)"}`);
  }
}

export {};
