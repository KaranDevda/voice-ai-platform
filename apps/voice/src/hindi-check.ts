/**
 * Hindi check for every voice: holds a scripted Hindi conversation with the voice service for each voice and reports, per turn,
 *   heard   how closely what the AI wrote down matches what was said to it,
 *   replied whether the reply is Hindi and well-formed (gender forms, no leaked note, the right price),
 *   sounds  how closely a speech recogniser's reading of the AI's spoken audio matches the text the AI meant to say.
 * "sounds" is a machine proxy: only a native Hindi speaker can judge the voice itself.
 *
 *   pnpm --filter @voiceai/voice hindi-check -- --voices "Karan=profile:<id>:male,Suhani=profile:<id>:female,Built-in man=pocket:michael:male"
 * Needs the voice service, the local speech servers (pnpm dev:stack) and AskG1 (or the backup model).
 */
import { writeFileSync } from "node:fs";
import { signVoiceToken } from "@voiceai/auth";
import WebSocket from "ws";

try { process.loadEnvFile(".env.local"); } catch { /* the secret can also come from the real environment */ }
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback; };
const URL_ = arg("url", `ws://127.0.0.1:${process.env.PORT ?? 4001}/stream`);
const ORG = arg("org", "1f927c2b-598f-4ab7-80be-db3598f5e4f8");
const SUB = arg("sub", "00000000-0000-4000-8000-000000000001");
const SPEAKER = arg("speaker", "hf_alpha");
const KOKORO = process.env.KOKORO_URL ?? "http://127.0.0.1:8768";
const WHISPER = process.env.WHISPER_URL ?? "http://127.0.0.1:8767";
const KEY = process.env.VOICE_TOKEN_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
if (!KEY) { console.error("Set SESSION_SECRET in apps/voice/.env.local"); process.exit(2); }

/** name=voice:gender, comma separated. A voice is `profile:<uuid>` or `pocket:<built-in name>`. */
const VOICES = arg("voices", "").split(",").filter(Boolean).map((v) => {
  const [name, rest] = [v.slice(0, v.indexOf("=")), v.slice(v.indexOf("=") + 1)];
  const gender = rest.slice(rest.lastIndexOf(":") + 1) as "male" | "female";
  return { name, voice: rest.slice(0, rest.lastIndexOf(":")), gender };
});
if (!VOICES.length) { console.error("Give --voices \"Name=voice:gender,...\""); process.exit(2); }

/** What is said to the AI, and what a correct reply must contain (any one of the listed fragments). */
const SCRIPT: Array<{ say: string; must?: string[]; mustNot?: RegExp }> = [
  { say: "नमस्ते, आप कैसे हैं?" },
  { say: "बिज़नेस प्लान की कीमत क्या है?", must: ["निन्यानवे", "4,999", "४,९९९"] },
  { say: "क्या आप कॉल रिकॉर्ड करते हैं?", must: ["रिकॉर्ड"] },
  { say: "आप कौन सी भाषाएँ बोलते हैं?", must: ["हिंदी", "हिन्दी", "अंग्रेज़ी", "अंग्रेजी", "English"] },
  { say: "मुझे इस हफ़्ते डेमो चाहिए।", must: ["डेमो"] },
  { say: "ठीक है, धन्यवाद।", must: ["धन्यवाद", "स्वागत", "शुक्रिया", "अच्छा दिन", "दिन"] },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, "");
function similarity(a: string, b: string): number {
  const x = [...norm(a)], y = [...norm(b)];
  if (!x.length && !y.length) return 1;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[y.length]! / Math.max(x.length, y.length);
}

function wav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

const speechCache = new Map<string, Int16Array>();
async function callerSpeech(text: string): Promise<Int16Array> {
  const hit = speechCache.get(text);
  if (hit) return hit;
  const r = await fetch(`${KOKORO}/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: SPEAKER, lang: "hi" }) });
  if (!r.ok) throw new Error(`Kokoro answered ${r.status}`);
  const w = Buffer.from(await r.arrayBuffer());
  const rate = w.readUInt32LE(24);
  const pcm = new Int16Array(w.buffer.slice(w.byteOffset + 44, w.byteOffset + w.length - ((w.length - 44) & 1)));
  const out = new Int16Array(Math.floor((pcm.length * 16000) / rate));
  for (let i = 0; i < out.length; i++) { const x = (i * rate) / 16000, j = Math.floor(x), f = x - j; out[i] = Math.round(pcm[j]! * (1 - f) + (pcm[j + 1] ?? pcm[j]!) * f); }
  speechCache.set(text, out);
  return out;
}

async function readBack(pcm: Buffer, rate: number): Promise<string> {
  const form = new FormData();
  form.set("file", new Blob([wav(pcm, rate) as unknown as BlobPart], { type: "audio/wav" }), "reply.wav");
  form.set("language", "hi"); form.set("response_format", "json"); form.set("temperature", "0.0");
  const r = await fetch(`${WHISPER}/inference`, { method: "POST", body: form });
  return r.ok ? (((await r.json()) as { text?: string }).text ?? "").replace(/\s+/g, " ").trim() : "";
}

interface Turn { said: string; heard: string; heardScore: number; replied: string; problems: string[]; readBack: string; soundsScore: number; firstWordS: number | null }
interface VoiceResult { name: string; voice: string; notices: string[]; turns: Turn[]; failed?: string }

async function runVoice(v: (typeof VOICES)[number]): Promise<VoiceResult> {
  const res: VoiceResult = { name: v.name, voice: v.voice, notices: [], turns: [] };
  const ws = new WebSocket(`${URL_}?token=${encodeURIComponent(signVoiceToken({ sub: SUB, org: ORG }, KEY!, 900))}`, { headers: { origin: arg("origin", "http://localhost:3000") } });
  let ready = false, rate = 24000, state = "", audio: Buffer[] = [], heard: string[] = [], said: string[] = [], timing = false, failed: string | null = null, closed: string | null = null, firstAudio = 0;
  ws.on("message", (data, isBinary) => {
    if (isBinary) { if (!firstAudio) firstAudio = performance.now(); audio.push(Buffer.from(data as Buffer)); return; }
    const e = JSON.parse(data.toString()) as { type: string; state?: string; text?: string; message?: string; audio?: { rate: number }; replace?: boolean };
    if (e.type === "ready") { ready = true; rate = e.audio?.rate ?? rate; }
    else if (e.type === "state") state = e.state ?? "";
    else if (e.type === "user" && e.text) heard.push(e.text);
    else if (e.type === "assistant" && e.text) said.push(e.text);
    else if (e.type === "notice" && e.message) res.notices.push(e.message);
    else if (e.type === "timing") timing = true;
    else if (e.type === "error") failed = e.message ?? "error";
    else if (e.type === "blocked") failed = `blocked: ${e.message}`;
  });
  ws.on("close", (c) => { closed = `closed (${c})`; });
  ws.on("error", (e) => { closed = `socket error: ${e.message}`; });
  try {
    await new Promise<void>((ok, bad) => { ws.once("open", () => ok()); ws.once("error", bad); ws.once("unexpected-response", (_q, r) => bad(new Error(`refused: ${r.statusCode}`))); });
    ws.send(JSON.stringify({ type: "start", language: "hi", voice: v.voice, greeting: false, listen: "anyone" }));
    for (let t = 0; !ready; t += 50) { if (failed || closed || t > 25000) throw new Error(failed ?? closed ?? "no ready message in 25 s"); await sleep(50); }
    const silence = Buffer.alloc(3200);
    for (const step of SCRIPT) {
      audio = []; heard = []; said = []; timing = false; failed = null; firstAudio = 0;
      const pcm = await callerSpeech(step.say);
      for (let o = 0; o < pcm.length; o += 1600) { ws.send(Buffer.from(pcm.slice(o, o + 1600).buffer)); await sleep(100); }
      const ended = performance.now();
      for (let t = 0; t < 90_000; t += 100) {
        if (failed || closed) throw new Error(failed ?? closed ?? "");
        if (timing && state === "listening") break;
        ws.send(silence); await sleep(100);
      }
      await sleep(300);
      const pcmReply = Buffer.concat(audio);
      const reply = said.join(" ").trim(), got = heard.join(" ").trim();
      const problems: string[] = [];
      if (!reply) problems.push("no reply");
      const dev = (reply.match(/\p{Script=Devanagari}/gu) ?? []).length, lat = (reply.match(/[A-Za-z]/g) ?? []).length;
      if (reply && dev < lat) problems.push("reply is not mainly Hindi");
      if (v.gender === "female" && /(सकता|करता|रहा|गया|देता|बताता|जोड़ता) ?(हूँ|हूं)/.test(reply)) problems.push("masculine forms for a female voice");
      if (v.gender === "male" && /(सकती|करती|रही|गई|देती|बताती|जोड़ती) ?(हूँ|हूं)/.test(reply)) problems.push("feminine forms for a male voice");
      if (/company knowledge|reply language|\[note|knowledge:/i.test(reply)) problems.push("read the system note aloud");
      if (step.must && !step.must.some((m) => reply.includes(m))) problems.push(`missing: ${step.must.slice(0, 2).join(" / ")}`);
      const rb = pcmReply.length ? await readBack(pcmReply, rate) : "";
      res.turns.push({ said: step.say, heard: got, heardScore: similarity(step.say, got), replied: reply, problems, readBack: rb, soundsScore: reply ? similarity(reply, rb) : 0, firstWordS: firstAudio ? (firstAudio - ended) / 1000 : null });
    }
  } catch (e) { res.failed = e instanceof Error ? e.message : String(e); }
  finally { try { ws.close(1000); } catch { /* already closed */ } }
  return res;
}

const pc = (x: number) => `${Math.round(x * 100)}%`;
const results: VoiceResult[] = [];
for (const v of VOICES) {
  console.log(`\n=== ${v.name} (${v.voice}, ${v.gender})`);
  const r = await runVoice(v);
  results.push(r);
  for (const n of r.notices) console.log(`  notice: ${n}`);
  if (r.failed) console.log(`  FAILED: ${r.failed}`);
  r.turns.forEach((t, i) => {
    console.log(`  ${i + 1}. said    ${t.said}\n     heard   ${t.heard || "(nothing)"}  [${pc(t.heardScore)}]\n     replied ${t.replied || "(nothing)"}\n     read back ${t.readBack || "(nothing)"}  [${pc(t.soundsScore)}]${t.problems.length ? `\n     PROBLEMS: ${t.problems.join("; ")}` : ""}`);
  });
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
console.log("\n=== Summary (per voice)");
console.log("voice".padEnd(22), "heard".padEnd(7), "sounds".padEnd(7), "problems".padEnd(9), "first sound");
for (const r of results) {
  const fw = r.turns.map((t) => t.firstWordS).filter((x): x is number => x !== null).sort((a, b) => a - b);
  console.log(r.name.padEnd(22), pc(avg(r.turns.map((t) => t.heardScore))).padEnd(7), pc(avg(r.turns.map((t) => t.soundsScore))).padEnd(7), String(r.turns.reduce((n, t) => n + t.problems.length, 0) + (r.failed ? 1 : 0)).padEnd(9), fw.length ? `${fw[Math.floor(fw.length / 2)]!.toFixed(1)} s` : "-");
}
const out = arg("json", "");
if (out) writeFileSync(out, JSON.stringify(results, null, 1));
process.exit(0);
