/**
 * Three scripted phone conversations, in English, Hindi and Hinglish, through the real voice service: the caller's lines are spoken
 * (local Kokoro voice), streamed in real time over the call WebSocket, heard by the real speech-to-text, answered by the real AI and
 * voice. Every flow is: greeting -> Business plan -> Starter plan -> book a call (name Karan, Tuesday 24 November, 1 PM) -> goodbye.
 * For each turn it prints what was said, what was heard, the reply, where it came from, and every latency stage.
 *
 *   pnpm --filter @voiceai/voice exec tsx src/conversation-test.ts -- --sub <user id> --org <org id> [--voice pocket:alba] [--out result.json]
 *
 * With a real user (--sub/--org) the call uses that organisation's knowledge base and settings, is saved to the call log, and a
 * booking it makes is saved too. Needs the voice service (pnpm dev:voice) and the local speech servers (pnpm dev:stack) running.
 */
import { writeFileSync } from "node:fs";
import { signVoiceToken } from "@voiceai/auth";
import { hinglishToDevanagari } from "@voiceai/providers";
import WebSocket from "ws";

try { process.loadEnvFile(".env.local"); } catch { /* the secret can also come from the real environment */ }
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback; };
const URL_ = arg("url", `ws://127.0.0.1:${process.env.PORT ?? 4001}/stream`);
const SUB = arg("sub", "00000000-0000-4000-8000-000000000001");
const ORG = arg("org", "00000000-0000-4000-8000-0000000000aa");
const ORIGIN = arg("origin", "http://localhost:3000");
const KOKORO = arg("kokoro", process.env.KOKORO_URL ?? "http://127.0.0.1:8768");
const OUT = arg("out", "");
const ONLY = arg("only", "");
const REPLY_TIMEOUT_MS = Number(arg("reply-timeout", "45000"));
const KEY = process.env.VOICE_TOKEN_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
if (!KEY) { console.error("Set SESSION_SECRET (apps/voice/.env.local) so the test can sign a stream token."); process.exit(2); }

interface Flow { language: "en" | "hi" | "en-hi"; name: string; voice: string; speaker: string; lines: string[]; ifTimePassed: string }
const FLOWS: Flow[] = [
  { language: "en", name: "English", voice: arg("voice-en", arg("voice", "pocket:alba")), speaker: "am_michael", ifTimePassed: "4 PM.",
    lines: ["Hello.", "What does the Business plan cost?", "And what about the Starter plan?", "I'd like to schedule a call.", "My name is Karan.", "Tuesday, 24th November.", "1 PM.", "Thank you, bye."] },
  { language: "hi", name: "Hindi", voice: arg("voice-hi", arg("voice", "pocket:alba")), speaker: "hm_omega", ifTimePassed: "शाम चार बजे।",
    lines: ["नमस्ते।", "बिज़नेस प्लान की कीमत क्या है?", "और स्टार्टर प्लान में क्या मिलता है?", "मुझे एक कॉल शेड्यूल करनी है।", "मेरा नाम करन है।", "मंगलवार, चौबीस नवंबर।", "दोपहर एक बजे।", "धन्यवाद।"] },
  { language: "en-hi", name: "Hinglish", voice: arg("voice-hinglish", arg("voice", "pocket:alba")), speaker: "hm_omega", ifTimePassed: "Shaam 4 baje.",
    lines: ["Hello, kaise ho aap?", "Business plan ka price kya hai?", "Aur Starter plan mein kya milta hai?", "Mujhe ek call schedule karni hai.", "Mera naam Karan hai.", "Tuesday, 24 November.", "Dopahar 1 baje.", "Thank you, bye."] },
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function speech(text: string, speaker: string, lang: "en" | "hi"): Promise<Int16Array> {
  const r = await fetch(`${KOKORO}/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: speaker, lang: lang === "en" ? "en-us" : "hi" }) });
  if (!r.ok) throw new Error(`Kokoro answered ${r.status}`);
  const wav = Buffer.from(await r.arrayBuffer());
  const rate = wav.readUInt32LE(24);
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) >> 1);
  const out = new Int16Array(Math.floor((pcm.length * 16000) / rate));
  for (let i = 0; i < out.length; i++) { const x = (i * rate) / 16000, j = Math.floor(x), f = x - j; out[i] = Math.round(pcm[j]! * (1 - f) + (pcm[j + 1] ?? pcm[j]!) * f); }
  return out;
}

interface Stages { source?: string; speechToTextMs?: number; llmFirstTokenMs?: number; firstSentenceMs?: number; ttsFirstAudioMs?: number; totalMs?: number; answerMs?: number; heardMs?: number; answerHeardMs?: number; audioFromCache?: boolean; groundMs?: number }
interface Turn { said: string; heard: string; reply: string; clientFirstSoundMs: number | null; stages?: Stages; notices: string[] }

async function runFlow(f: Flow): Promise<{ flow: string; ok: boolean; why?: string; turns: Turn[] }> {
  const token = signVoiceToken({ sub: SUB, org: ORG }, KEY!, 600);
  const ws = new WebSocket(`${URL_}?token=${encodeURIComponent(token)}`, { headers: { origin: ORIGIN } });
  const turns: Turn[] = [];
  let ready = false, failed: string | null = null, closed: string | null = null, state = "", audioAt = 0, assistants = 0;
  let heard: string[] = [], reply: string[] = [], stages: Stages | undefined, notices: string[] = [];
  ws.on("message", (data, isBinary) => {
    if (isBinary) { if (!audioAt) audioAt = performance.now(); return; }
    const e = JSON.parse(data.toString()) as { type: string; state?: string; text?: string; message?: string; replace?: boolean };
    if (e.type === "ready") ready = true;
    else if (e.type === "state") state = e.state ?? "";
    else if (e.type === "user" && e.text) { if (e.replace) heard = [e.text]; else heard.push(e.text); }
    else if (e.type === "assistant" && e.text) { assistants++; reply.push(e.text); }
    else if (e.type === "timing") stages = e as unknown as Stages;
    else if (e.type === "notice" && e.message) notices.push(e.message);
    else if (e.type === "error") failed = e.message ?? "error";
  });
  ws.on("close", (code) => { closed = `closed (${code})`; });
  ws.on("error", (e) => { closed = `socket error: ${e.message}`; });
  const CH = 1600, silence = Buffer.alloc(CH * 2);
  const say = async (line: string) => {
    const spoken = f.language === "en" ? line : hinglishToDevanagari(line);
    const pcm = await speech(spoken, f.speaker, f.language === "en" ? "en" : "hi");
    audioAt = 0; heard = []; reply = []; stages = undefined; notices = [];
    const before = assistants;
    for (let o = 0; o < pcm.length; o += CH) { ws.send(Buffer.from(pcm.slice(o, o + CH).buffer)); await sleep(100); }
    const spokeEnd = performance.now();
    for (let t = 0; t < REPLY_TIMEOUT_MS; t += 100) {
      if (failed || closed) throw new Error(failed ?? closed ?? "");
      if (state === "listening" && assistants > before && stages) break;
      ws.send(silence); await sleep(100);
    }
    for (let t = 0; t < 1500; t += 100) { ws.send(silence); await sleep(100); } // let the last timing / notice arrive
    const st = stages as Stages | undefined; // set by the message handler above
    const turn: Turn = { said: line, heard: heard.join(" "), reply: reply.join(" "), clientFirstSoundMs: audioAt ? Math.round(audioAt - spokeEnd) : null, stages: st, notices: [...notices] };
    turns.push(turn);
    console.log(`\n  caller said : ${line}`);
    console.log(`  AI heard    : ${turn.heard || "(nothing)"}`);
    console.log(`  AI replied  : ${turn.reply || "(nothing)"}`);
    if (st) console.log(`  timing      : ${st.source ?? "?"} | stopped->text ${st.speechToTextMs ?? "?"} ms | text->AI word ${st.llmFirstTokenMs ?? "?"} ms | text->1st sentence ${st.firstSentenceMs ?? "?"} ms | voice ${st.audioFromCache ? "saved audio" : `${st.ttsFirstAudioMs ?? "?"} ms`} | stopped->first sound ${st.heardMs ?? "?"} ms | stopped->answer ${st.answerHeardMs ?? "?"} ms | client ${turn.clientFirstSoundMs ?? "?"} ms`);
    for (const n of turn.notices) console.log(`  notice      : ${n}`);
    return turn;
  };
  try {
    await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); ws.once("unexpected-response", (_q, r) => rej(new Error(`refused: ${r.statusCode}`))); });
    ws.send(JSON.stringify({ type: "start", language: f.language, voice: f.voice, greeting: false, listen: "anyone" }));
    for (let t = 0; !ready; t += 50) { if (failed || closed || t > 20000) throw new Error(failed ?? closed ?? "no ready message in 20 s"); await sleep(50); }
    for (const line of f.lines) {
      const turn = await say(line);
      // 1 PM today may already have passed when the test runs: the booking flow then asks for another time, and the caller gives one.
      if (/already passed|निकल चुका/i.test(turn.reply)) await say(f.ifTimePassed);
    }
    return { flow: f.name, ok: true, turns };
  } catch (e) {
    return { flow: f.name, ok: false, why: e instanceof Error ? e.message : String(e), turns };
  } finally { try { ws.close(1000); } catch { /* already closed */ } }
}

const results = [];
for (const f of FLOWS.filter((x) => !ONLY || x.name.toLowerCase() === ONLY.toLowerCase())) {
  console.log(`\n=== ${f.name} (${f.language}, voice ${f.voice}) ===`);
  const r = await runFlow(f);
  if (!r.ok) console.log(`  FAILED: ${r.why}`);
  results.push(r);
}
if (OUT) writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
process.exit(results.every((r) => r.ok) ? 0 : 1);
