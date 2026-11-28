/**
 * Measures Maya 2 (voice) and the avatar (lip-sync video) latency, then writes the report in English, Hindi and Hinglish.
 *   npx tsx scripts/latency-maya2-avatar.mts [photo.jpg]
 * Reads MAYA2_URL / MAYA2_TOKEN from apps/web/.env.local and AVATAR_URL from the environment or the same file. The photo is optional:
 * without it only Maya 2 is measured. Nothing is estimated: a part that cannot be reached is reported as "not measured".
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { hinglishToDevanagari } from "../packages/providers/src/hinglish";

const env: Record<string, string> = {};
for (const l of readFileSync(new URL("../apps/web/.env.local", import.meta.url), "utf8").split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]!] = m[2]!.trim(); }
const MAYA = (process.env.MAYA2_URL ?? env.MAYA2_URL ?? "").replace(/\/$/, ""), TOKEN = process.env.MAYA2_TOKEN ?? env.MAYA2_TOKEN ?? "";
const AVATAR = (process.env.AVATAR_URL ?? env.AVATAR_URL ?? "").replace(/\/$/, "");
const photoPath = process.argv[2];
const refWav = join(homedir(), "Desktop/reports/maya-en.wav");
const H = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const RUNS = 3;

const TEXTS = {
  English: "Hello, thank you for calling. How can I help you today?",
  Hindi: "नमस्ते, कॉल करने के लिए धन्यवाद। मैं आज आपकी कैसे मदद कर सकती हूँ?",
  Hinglish: hinglishToDevanagari("Namaste, aapka order confirm ho gaya hai, delivery kal tak ho jayegi."),
};
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)]! : NaN; };

interface Row { lang: string; firstAudioMs: number; totalMs: number; audioMs: number; rtf: number; pcm: Uint8Array }
async function maya(): Promise<{ rows: Row[]; note?: string }> {
  if (!MAYA) return { rows: [], note: "MAYA2_URL is not set" };
  try {
    const h = await fetch(`${MAYA}/health`, { headers: H, signal: AbortSignal.timeout(6000) });
    if (!h.ok) return { rows: [], note: `Maya 2 health returned ${h.status}` };
  } catch (e) { return { rows: [], note: `Maya 2 is not reachable (${(e as Error).cause ?? (e as Error).message})` }; }
  const ref = readFileSync(refWav);
  const reg = await fetch(`${MAYA}/v1/voices`, { method: "POST", headers: H, body: JSON.stringify({ voice_id: "latency-test", ref_audio_b64: ref.toString("base64"), mode: "spk", replace: true }) });
  if (!reg.ok) return { rows: [], note: `could not register the test voice: ${reg.status}` };
  const rows: Row[] = [];
  for (const [lang, text] of Object.entries(TEXTS)) {
    const first: number[] = [], total: number[] = []; let pcm = new Uint8Array(0);
    for (let i = 0; i < RUNS + 1; i++) {                          // run 0 is a warm-up and is dropped
      const t0 = performance.now();
      const r = await fetch(`${MAYA}/v1/audio/speech`, { method: "POST", headers: H, body: JSON.stringify({ model: "maya3", input: text, voice: "latency-test", language: /[ऀ-ॿ]/.test(text) ? "hi" : "en", response_format: "pcm", normalize: true }) });
      const reader = r.body!.getReader(); const parts: Uint8Array[] = []; let f = NaN;
      for (;;) { const { done, value } = await reader.read(); if (done) break; if (value?.length) { if (Number.isNaN(f)) f = performance.now() - t0; parts.push(value); } }
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
      if (i > 0) { first.push(f); total.push(performance.now() - t0); pcm = all; }
    }
    const audioMs = (pcm.length / 2 / 24000) * 1000;
    rows.push({ lang, firstAudioMs: Math.round(med(first)), totalMs: Math.round(med(total)), audioMs: Math.round(audioMs), rtf: +(med(total) / audioMs).toFixed(2), pcm });
  }
  return { rows };
}

interface Av { prepareMs: number; firstFrameMs: number; fps: number; renderMs: number; audioMs: number; late: boolean }
async function avatar(pcm: Uint8Array | undefined): Promise<{ av?: Av; note?: string }> {
  if (!AVATAR) return { note: "AVATAR_URL is not set (the Colab avatar notebook is not running)" };
  if (!photoPath) return { note: "no photo was given" };
  if (!pcm) return { note: "no Maya 2 audio to drive it with" };
  try {
    const t0 = performance.now();
    const res = await fetch(`${AVATAR}/avatar`, { method: "POST", body: readFileSync(photoPath), headers: { "content-type": "image/jpeg" }, signal: AbortSignal.timeout(60000) });
    const info = await res.json() as { avatar_id?: string; error?: string; fps?: number };
    if (!res.ok || !info.avatar_id) return { note: info.error ?? `avatar server answered ${res.status}` };
    const prepareMs = Math.round(performance.now() - t0);
    const ws = new WebSocket(`${AVATAR.replace(/^http/, "ws")}/stream/${info.avatar_id}`); ws.binaryType = "arraybuffer";
    await new Promise<void>((ok, bad) => { ws.onopen = () => ok(); ws.onerror = () => bad(new Error("websocket failed")); });
    const run = () => new Promise<Av>((resolve) => {
      const buf = new Uint8Array(8 + Math.min(pcm.length, 24000 * 2 * 2)); const dv = new DataView(buf.buffer); dv.setUint32(0, 1, true); dv.setUint32(4, 24000, true); buf.set(pcm.subarray(0, buf.length - 8), 8);
      const s = performance.now(); let first = NaN;
      ws.onmessage = (m) => {
        if (typeof m.data !== "string") { if (Number.isNaN(first)) first = performance.now() - s; return; }
        const j = JSON.parse(m.data); if (j.type === "done") resolve({ prepareMs, firstFrameMs: Math.round(first), fps: j.fps, renderMs: j.render_ms, audioMs: j.audio_ms, late: j.render_ms > j.audio_ms });
      };
      ws.send(buf);
    });
    await run(); const av = await run();                              // the first run warms the GPU
    ws.close(); return { av };
  } catch (e) { return { note: `the avatar server is not reachable (${(e as Error).message})` }; }
}

const m = await maya();
const a = await avatar(m.rows[0]?.pcm);
const fmt = (v: number) => (Number.isNaN(v) ? "—" : String(v));
const target = (ms: number) => (ms <= 1000 ? "✔" : "✘");
const day = new Date().toISOString().slice(0, 10);

function section(l: "en" | "hi" | "hing"): string {
  const T = {
    en: { h: "Latency report: Maya 2 voice and live avatar", v: "Maya 2 voice (time until the first sound, and time to make the whole sentence)", c: ["Language", "First sound (ms)", "Whole sentence (ms)", "Speech length (ms)", "Speed vs real time"], av: "Avatar (lip-sync video)", pre: "Face preparation", ff: "First video frame", rn: "Render time for the speech", ok: "Faster than real time: smooth", slow: "Slower than real time: will lag", nm: "Not measured", why: "Reason", tot: "Expected delay before the person sees and hears the first word", note: "Speed vs real time below 1.0 means it makes audio faster than it plays. Target: first sound under 1000 ms." },
    hi: { h: "लेटेंसी रिपोर्ट: Maya 2 आवाज़ और लाइव अवतार", v: "Maya 2 आवाज़ (पहली आवाज़ आने तक का समय और पूरा वाक्य बनने का समय)", c: ["भाषा", "पहली आवाज़ (ms)", "पूरा वाक्य (ms)", "बोलने की लंबाई (ms)", "रियल-टाइम से गति"], av: "अवतार (लिप-सिंक वीडियो)", pre: "चेहरा तैयार करने का समय", ff: "पहला वीडियो फ्रेम", rn: "बोले गए हिस्से को बनाने का समय", ok: "रियल-टाइम से तेज़: स्मूद", slow: "रियल-टाइम से धीमा: देरी होगी", nm: "मापा नहीं गया", why: "कारण", tot: "पहला शब्द दिखने और सुनाई देने से पहले अनुमानित देरी", note: "रियल-टाइम से गति 1.0 से कम का मतलब है कि आवाज़ बजने से तेज़ बन रही है। लक्ष्य: पहली आवाज़ 1000 ms से कम।" },
    hing: { h: "Latency report: Maya 2 voice aur live avatar", v: "Maya 2 voice (pehli awaaz aane tak ka time aur poora sentence banne ka time)", c: ["Language", "Pehli awaaz (ms)", "Poora sentence (ms)", "Bolne ki length (ms)", "Real-time se speed"], av: "Avatar (lip-sync video)", pre: "Face taiyaar karne ka time", ff: "Pehla video frame", rn: "Speech ko render karne ka time", ok: "Real-time se tez: smooth", slow: "Real-time se slow: lag hoga", nm: "Measure nahi hua", why: "Wajah", tot: "Pehla word dikhne aur sunne se pehle andaza delay", note: "Real-time se speed 1.0 se kam matlab awaaz bajne se tez ban rahi hai. Target: pehli awaaz 1000 ms se kam." },
  }[l];
  let s = `## ${T.h} (${day})\n\n### ${T.v}\n\n`;
  if (m.rows.length) {
    s += `| ${T.c.join(" | ")} |\n|${T.c.map(() => "---").join("|")}|\n`;
    for (const r of m.rows) s += `| ${r.lang} | ${r.firstAudioMs} ${target(r.firstAudioMs)} | ${r.totalMs} | ${r.audioMs} | ${r.rtf} |\n`;
    s += `\n${T.note}\n`;
  } else s += `${T.nm}. ${T.why}: ${m.note}\n`;
  s += `\n### ${T.av}\n\n`;
  if (a.av) {
    const v = a.av;
    s += `- ${T.pre}: ${v.prepareMs} ms\n- ${T.ff}: ${fmt(v.firstFrameMs)} ms\n- ${T.rn}: ${v.renderMs} ms / ${v.audioMs} ms → ${v.late ? T.slow : T.ok}\n`;
    const first = m.rows[0]?.firstAudioMs;
    if (first !== undefined) s += `- ${T.tot}: ≈ ${first + v.firstFrameMs} ms\n`;
  } else s += `${T.nm}. ${T.why}: ${a.note}\n`;
  return s;
}

const report = `${section("en")}\n---\n\n${section("hi")}\n---\n\n${section("hing")}`;
const dir = join(homedir(), "Desktop/reports"); mkdirSync(dir, { recursive: true });
const out = join(dir, `latency-maya2-avatar-${day}.md`);
writeFileSync(out, report);
console.log(report); console.log(`\nSaved: ${out}`);
