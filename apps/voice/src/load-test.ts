/**
 * Load test for the voice service: runs scripted calls against it, several at once, and reports how long the caller waits for
 * the first word of the answer.
 *
 *   pnpm --filter @voiceai/voice load-test -- --calls 20 --concurrency 20          (20 calls at once)
 *   Options: --questions "one|two" (what the caller says), --sub/--org (a real user, so the call is saved to the call log),
 *   --lead <id> (an outbound call, checked against Do Not Disturb, consent and hours).
 *   pnpm --filter @voiceai/voice load-test -- --calls 50 --concurrency 10 --turns 2  (50 scripted calls)
 *
 * What a "call" is here: a real WebSocket session, a real signed stream token, and spoken audio (made with the local Kokoro
 * voice) sent in real time, with a pause after each question. So it exercises the whole chain: speech recognition, AskG1,
 * the voice, and the session limit. It does not use a phone line, so it says nothing about the carrier.
 *
 * Needs the voice service (pnpm dev:voice) and the local speech servers (pnpm dev:stack) running.
 */
import { signVoiceToken } from "@voiceai/auth";
import WebSocket from "ws";

try { process.loadEnvFile(".env.local"); } catch { /* the secret can also come from the real environment */ }

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const CALLS = Number(arg("calls", "20"));
const CONCURRENCY = Math.min(CALLS, Number(arg("concurrency", String(CALLS))));
const TURNS = Math.max(1, Number(arg("turns", "2")));
const URL_ = arg("url", `ws://127.0.0.1:${process.env.PORT ?? 4001}/stream`);
const VOICE = arg("voice", "pocket:alba");
const LANGUAGE = arg("language", "en");
const SUB = arg("sub", "00000000-0000-4000-8000-000000000001"); // a user that does not exist: the call is served but not saved
const ORG = arg("org", "00000000-0000-4000-8000-0000000000aa");
const ORIGIN = arg("origin", "http://localhost:3000");
const SPEAKER = arg("speaker", "am_michael");
const KOKORO = arg("kokoro", process.env.KOKORO_URL ?? "http://127.0.0.1:8768");
const REPLY_TIMEOUT_MS = Number(arg("reply-timeout", "30000"));
const KEY = process.env.VOICE_TOKEN_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
if (!KEY) { console.error("Set SESSION_SECRET (apps/voice/.env.local) so the test can sign a stream token."); process.exit(2); }

const SHOW = process.argv.includes("--show");
const LEAD = process.argv.includes("--lead") ? arg("lead", "") : "";
const QUESTIONS = process.argv.includes("--questions") ? arg("questions", "").split("|").filter(Boolean) : [
  "Hello, I wanted to ask about your plans.",
  "How much does the business plan cost?",
  "Do you record the calls?",
  "Which languages do you support?",
  "Can I get a demo this week?",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]! : NaN);

/** 16 kHz mono 16-bit speech for a phrase, from the local Kokoro server. */
const cache = new Map<string, Int16Array>();
async function speech(text: string): Promise<Int16Array> {
  const hit = cache.get(text);
  if (hit) return hit;
  const r = await fetch(`${KOKORO}/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: SPEAKER }) });
  if (!r.ok) throw new Error(`Kokoro answered ${r.status}`);
  const wav = Buffer.from(await r.arrayBuffer());
  const rate = wav.readUInt32LE(24);
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) >> 1);
  const out = new Int16Array(Math.floor((pcm.length * 16000) / rate));
  for (let i = 0; i < out.length; i++) { // linear resample to 16 kHz
    const x = (i * rate) / 16000, j = Math.floor(x), f = x - j;
    out[i] = Math.round(pcm[j]! * (1 - f) + (pcm[j + 1] ?? pcm[j]!) * f);
  }
  cache.set(text, out);
  return out;
}

interface Stages { answerMs?: number; ackMs?: number; llmFirstTokenMs: number; firstSentenceMs: number; ttsFirstAudioMs: number; totalMs: number; groundMs?: number }
interface TurnResult { firstWordMs: number | null; serverMs: number | null; stages?: Stages }
interface CallResult { ok: boolean; why?: string; turns: TurnResult[] }

async function oneCall(n: number): Promise<CallResult> {
  const token = signVoiceToken({ sub: SUB, org: ORG }, KEY!, 120);
  const ws = new WebSocket(`${URL_}?token=${encodeURIComponent(token)}`, { headers: { origin: ORIGIN } });
  const turns: TurnResult[] = [];
  let lastStages: Stages | null = null, handedOff = false, ready = false, failed: string | null = null, audioAt = 0, timing: number | null = null, state = "";
  ws.on("message", (data, isBinary) => {
    if (isBinary) { if (!audioAt) audioAt = performance.now(); return; }
    const e = JSON.parse(data.toString()) as { type: string; state?: string; message?: string; totalMs?: number };
    if (e.type === "ready") ready = true;
    else if (e.type === "state") state = e.state ?? "";
    else if (e.type === "timing") { timing = e.totalMs ?? null; lastStages = e as unknown as Stages; }
    else if (e.type === "error") failed = e.message ?? "error";
    else if (e.type === "blocked") failed = `blocked: ${e.message}`;
    else if (e.type === "handoff") handedOff = true;
    if (SHOW && (e.type === "user" || e.type === "assistant" || e.type === "notice")) console.log(`  [call ${n}] ${e.type === "user" ? "heard    " : e.type === "assistant" ? "AI said  " : "notice   "}: ${(e as unknown as { text?: string; message?: string }).text ?? (e as unknown as { message?: string }).message}`);
  });
  let closed: string | null = null;
  ws.on("close", (code) => { closed = `closed (${code})`; });
  ws.on("error", (e) => { closed = `socket error: ${e.message}`; });
  try {
    await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); ws.once("unexpected-response", (_q, r) => rej(new Error(`refused: ${r.statusCode}`))); });
    ws.send(JSON.stringify({ type: "start", language: LANGUAGE, voice: VOICE, greeting: false, listen: "anyone", ...(LEAD ? { leadId: LEAD } : {}) }));
    for (let t = 0; !ready; t += 50) { if (failed || closed || t > 20000) throw new Error(failed ?? closed ?? "no ready message in 20 s"); await sleep(50); }
    for (let i = 0; i < TURNS; i++) {
      const pcm = await speech(QUESTIONS[(n + i) % QUESTIONS.length]!);
      audioAt = 0; timing = null; lastStages = null;
      const CH = 1600; // 100 ms
      for (let o = 0; o < pcm.length; o += CH) { // in real time, as a microphone would
        ws.send(Buffer.from(pcm.slice(o, o + CH).buffer));
        await sleep(100);
      }
      const spokeEnd = performance.now();
      const silence = Buffer.alloc(CH * 2); // quiet after the question, so the recogniser can tell it ended
      for (let t = 0; !audioAt && t < REPLY_TIMEOUT_MS; t += 100) {
        if (failed || closed) throw new Error(failed ?? closed ?? "");
        ws.send(silence); await sleep(100);
      }
      if (!audioAt) { turns.push({ firstWordMs: null, serverMs: null }); throw new Error(`no answer within ${REPLY_TIMEOUT_MS / 1000} s`); }
      turns.push({ firstWordMs: audioAt - spokeEnd, serverMs: null });
      // let the answer finish and the AI go back to listening before the next question
      for (let t = 0; t < REPLY_TIMEOUT_MS; t += 100) { if (state === "listening" && timing !== null) break; ws.send(silence); await sleep(100); }
      turns[turns.length - 1]!.serverMs = timing;
      turns[turns.length - 1]!.stages = lastStages ?? undefined;
    }
    if (handedOff) console.log("  (this call was handed over to a person)");
    return { ok: true, turns };
  } catch (e) {
    return { ok: false, why: e instanceof Error ? e.message : String(e), turns };
  } finally {
    try { ws.close(1000); } catch { /* already closed */ }
  }
}

async function main() {
  console.log(`Load test: ${CALLS} scripted calls, ${CONCURRENCY} at a time, ${TURNS} question(s) each, voice ${VOICE}, ${LANGUAGE}`);
  console.log("Preparing the spoken questions...");
  await Promise.all(QUESTIONS.slice(0, Math.min(QUESTIONS.length, TURNS + CALLS)).map(speech));
  const health = () => fetch(URL_.replace(/^ws/, "http").replace(/\/stream.*/, "/healthz")).then((r) => r.json() as Promise<{ sessions: number }>, () => null);
  let peak = 0, next = 0;
  const results: CallResult[] = [];
  const poll = setInterval(async () => { const h = await health(); if (h) peak = Math.max(peak, h.sessions); }, 250);
  const t0 = performance.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const n = next++;
      if (n >= CALLS) return;
      const r = await oneCall(n);
      results.push(r);
      process.stdout.write(r.ok ? "." : "x");
    }
  }));
  clearInterval(poll);
  console.log(`\nDone in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  const first = results.flatMap((r) => r.turns.map((t) => t.firstWordMs).filter((x): x is number => x !== null));
  const failedCalls = results.filter((r) => !r.ok);
  const why = new Map<string, number>();
  for (const r of failedCalls) why.set(r.why ?? "?", (why.get(r.why ?? "?") ?? 0) + 1);
  console.log(`Calls: ${results.length - failedCalls.length} of ${results.length} finished all their questions; most sessions open at once: ${peak}`);
  for (const [w, c] of why) console.log(`  ${c}x failed: ${w}`);
  if (first.length) {
    const s = (x: number) => `${(x / 1000).toFixed(2)} s`;
    console.log(`Time from the end of the question to the first word (${first.length} answers): median ${s(pct(first, 50))}, p95 ${s(pct(first, 95))}, slowest ${s(Math.max(...first))}`);
    const st = results.flatMap((r) => r.turns).filter((t) => t.stages && t.firstWordMs !== null);
    if (st.length) {
      const m = (f: (t: TurnResult) => number) => pct(st.map(f), 50);
      console.log(`Where the time goes (median of ${st.length}): listening and writing down the words ${s(m((t) => t.firstWordMs! - t.stages!.totalMs))}, AI first word ${s(m((t) => t.stages!.llmFirstTokenMs))} (of which company-knowledge search ${s(m((t) => t.stages!.groundMs ?? 0))}), AI first sentence ${s(m((t) => t.stages!.firstSentenceMs))}, voice first sound ${s(m((t) => t.stages!.ttsFirstAudioMs))}, from transcript to first sound ${s(m((t) => t.stages!.totalMs))}`);
      const ans = st.filter((t) => t.stages!.answerMs);
      if (ans.length) console.log(`Real answer heard (the acknowledgement is not counted, ${ans.length} answers): median ${s(pct(ans.map((t) => t.firstWordMs! - t.stages!.totalMs + t.stages!.answerMs!), 50))}, p95 ${s(pct(ans.map((t) => t.firstWordMs! - t.stages!.totalMs + t.stages!.answerMs!), 95))}; acknowledgement played on ${st.filter((t) => t.stages!.ackMs !== undefined).length} of ${st.length} turns`);
      if (arg("json", "")) (await import("node:fs")).writeFileSync(arg("json", ""), JSON.stringify(st.map((t) => ({ firstWordMs: Math.round(t.firstWordMs!), ...t.stages })), null, 1));
    }
    console.log(`Latency gate (median under 1.0 s): ${pct(first, 50) < 1000 ? "MET" : "NOT MET"}`);
  } else console.log("No answers were received, so there is no latency to report.");
  process.exit(failedCalls.length ? 1 : 0);
}
void main();
