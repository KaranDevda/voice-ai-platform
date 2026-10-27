/**
 * Pretends to be the phone carrier, to test the phone line without a real number. It signs requests the way Plivo does, opens the
 * audio stream, talks to the AI as a caller (spoken by the local Kokoro voice), and acts as Plivo's REST API for hand-overs and outbound calls.
 *
 * Start the voice service for it (see docs/PHONE_LINE.md), then:   pnpm --filter @voiceai/voice phone-sim
 * It checks what it can verify and prints PASS or FAIL for each. It proves OUR side of the protocol, written from Plivo's documentation;
 * it cannot prove that real Plivo behaves the same.
 */
import { createServer } from "node:http";
import { signVoiceToken } from "@voiceai/auth";
import { pcmToMulaw8k, plivoSignatureV3 } from "@voiceai/providers";
import WebSocket from "ws";

try { process.loadEnvFile(".env.local"); } catch { /* the secret can also come from the environment */ }
const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : d; };
const SERVICE = arg("service", "http://127.0.0.1:4003");
const TOKEN = process.env.PLIVO_AUTH_TOKEN ?? "fake-token-0123456789";
const KEY = (process.env.VOICE_TOKEN_SECRET ?? process.env.SESSION_SECRET)!;
const ORG = arg("org", ""), USER = arg("user", ""), DND_LEAD = arg("dnd-lead", ""), OK_LEAD = arg("lead", "");
const SPEAKER = arg("speaker", "am_michael"), KOKORO = arg("kokoro", "http://127.0.0.1:8768");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (c: boolean, m: string, x = "") => { console.log(`${c ? "PASS" : "FAIL"}  ${m}${x ? "  -> " + x : ""}`); if (!c) fails++; };

// --- a stand-in for Plivo's REST API
const apiCalls: Array<{ method: string; url: string; body: any }> = [];
const api = createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    apiCalls.push({ method: req.method!, url: req.url!, body: b ? JSON.parse(b) : undefined });
    res.writeHead(202, { "content-type": "application/json" }); res.end(JSON.stringify({ request_uuid: ["sim-request-1"], message: "ok" }));
  });
}).listen(4091);

async function speech(text: string): Promise<Uint8Array> {
  const r = await fetch(`${KOKORO}/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: SPEAKER }) });
  const wav = Buffer.from(await r.arrayBuffer()), rate = wav.readUInt32LE(24);
  const pcm = new Int16Array(wav.buffer, wav.byteOffset + 44, (wav.length - 44) >> 1), out = new Int16Array(Math.floor((pcm.length * 8000) / rate));
  for (let i = 0; i < out.length; i++) { const x = (i * rate) / 8000, j = Math.floor(x), f = x - j; out[i] = Math.round(pcm[j]! * (1 - f) + (pcm[j + 1] ?? pcm[j]!) * f); }
  return pcmToMulaw8k(out, 8000);
}

const signed = (path: string, params: Record<string, string>) => {
  const url = `${SERVICE}${path}`, nonce = `n${Date.now()}`;
  return { url, nonce, headers: { "content-type": "application/x-www-form-urlencoded", "x-plivo-signature-v3": plivoSignatureV3({ url, params, nonce, authToken: TOKEN }), "x-plivo-signature-v3-nonce": nonce }, body: new URLSearchParams(params).toString() };
};

async function main() {
  // 1. Only Plivo may ask for call instructions
  const params = { CallUUID: `sim-${Date.now()}`, From: "+919800000001", To: "+918000000000", Direction: "inbound" };
  const unsigned = await fetch(`${SERVICE}/plivo/answer`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
  ok(unsigned.status === 403, "an unsigned request for call instructions is refused", String(unsigned.status));
  const s0 = signed("/plivo/answer", params);
  const tampered = await fetch(s0.url, { method: "POST", headers: s0.headers, body: new URLSearchParams({ ...params, From: "+910000000000" }).toString() });
  ok(tampered.status === 403, "a request whose fields were changed after signing is refused", String(tampered.status));

  // 2. A genuine incoming call gets a two-way audio stream
  const s1 = signed("/plivo/answer", params);
  const answer = await fetch(s1.url, { method: "POST", headers: s1.headers, body: s1.body });
  const xml = await answer.text();
  ok(answer.status === 200 && xml.includes('bidirectional="true"') && xml.includes("audio/x-mulaw;rate=8000"), "a signed request is answered with a two-way 8 kHz µ-law stream", xml.slice(0, 60));
  const wsUrl = /<Stream[^>]*>([^<]+)<\/Stream>/.exec(xml)?.[1]?.replace(/&amp;/g, "&");
  if (!wsUrl) throw new Error("no stream address in the answer");

  // 3. The audio stream: say hello, hear the greeting and an answer
  const ws = new WebSocket(wsUrl);
  let played = 0, firstAudioAt = 0, playedAfterQuestion = 0; const types = new Set<string>();
  ws.on("message", (d) => { const m = JSON.parse(d.toString()); types.add(m.event); if (m.event === "playAudio") { played += Buffer.from(m.media.payload, "base64").length; if (!firstAudioAt) firstAudioAt = Date.now(); playedAfterQuestion = played; } });
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", rej); });
  ws.send(JSON.stringify({ event: "start", start: { callId: params.CallUUID, streamId: "sim-stream" } }));
  for (let i = 0; i < 300 && !played; i++) await sleep(100);
  ok(played > 0, "the AI's greeting comes back as playAudio messages", `${played} bytes`);
  await sleep(4000); // let the greeting finish so the question is not an interruption
  const before = played;
  const q = await speech("What plans do you have?"), CH = 160;
  const spokeEnd = (() => Date.now() + (q.length / 8000) * 1000)();
  for (let o = 0; o < q.length; o += CH) { ws.send(JSON.stringify({ event: "media", media: { track: "inbound", payload: Buffer.from(q.subarray(o, o + CH)).toString("base64") } })); await sleep(20); }
  const silence = Buffer.alloc(CH, 0xff).toString("base64");
  const t0 = Date.now();
  for (let i = 0; i < 400 && played === before; i++) { ws.send(JSON.stringify({ event: "media", media: { track: "inbound", payload: silence } })); await sleep(20); }
  ok(played > before, "after the caller's question, the AI answers by voice", `${((Date.now() - t0) / 1000).toFixed(1)} s after the end of the question, ${played - before} bytes`);
  void spokeEnd; void playedAfterQuestion;

  // 4. Interrupting: speaking over the AI clears the queued audio
  await sleep(300);
  const talk = await speech("Wait, stop, I have a question.");
  for (let o = 0; o < talk.length; o += CH) { ws.send(JSON.stringify({ event: "media", media: { track: "inbound", payload: Buffer.from(talk.subarray(o, o + CH)).toString("base64") } })); await sleep(20); }
  for (let i = 0; i < 100 && !types.has("clearAudio"); i++) { ws.send(JSON.stringify({ event: "media", media: { payload: silence } })); await sleep(20); }
  ok(types.has("clearAudio"), "speaking over the AI makes it send clearAudio so the carrier drops the queued speech");

  // 5. Asking for a person hands the call over through the carrier
  const person = await speech("I want to talk to a human agent please.");
  await sleep(6000);
  for (let o = 0; o < person.length; o += CH) { ws.send(JSON.stringify({ event: "media", media: { payload: Buffer.from(person.subarray(o, o + CH)).toString("base64") } })); await sleep(20); }
  for (let i = 0; i < 700 && !apiCalls.some((c) => c.url.includes(`/Call/${params.CallUUID}/`)); i++) { ws.send(JSON.stringify({ event: "media", media: { payload: silence } })); await sleep(20); }
  const transfer = apiCalls.find((c) => c.url.includes(`/Call/${params.CallUUID}/`));
  ok(!!transfer && transfer.body.aleg_url === `${SERVICE}/plivo/transfer` && transfer.body.legs === "aleg", "asking for a person makes the AI ask the carrier to move the call", JSON.stringify(transfer?.body));
  const t = signed("/plivo/transfer", {});
  const dial = await (await fetch(t.url, { method: "POST", headers: t.headers, body: t.body })).text();
  ok(/<Dial><Number>\+?\d+<\/Number><\/Dial>/.test(dial), "the carrier then gets instructions to dial the person's number", dial.slice(-70));

  // 6. Hang up: the call is saved
  ws.send(JSON.stringify({ event: "stop" })); await sleep(1500); ws.close();

  // 7. Placing an outbound AI call
  if (ORG && USER && KEY) {
    const auth = { authorization: `Bearer ${signVoiceToken({ sub: USER, org: ORG, voice: "pocket:alba" }, KEY, 60)}`, "content-type": "application/json" };
    const noAuth = await fetch(`${SERVICE}/plivo/outbound`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId: OK_LEAD }) });
    ok(noAuth.status === 401, "placing an outbound call without a signed token is refused", String(noAuth.status));
    if (DND_LEAD) {
      const before = apiCalls.length;
      const blocked = await fetch(`${SERVICE}/plivo/outbound`, { method: "POST", headers: auth, body: JSON.stringify({ leadId: DND_LEAD }) });
      ok(blocked.status === 409 && (await blocked.json()).reason === "dnd" && apiCalls.length === before, "a Do Not Disturb lead is refused and the carrier is never asked to dial", String(blocked.status));
    }
    if (OK_LEAD) {
      const r = await fetch(`${SERVICE}/plivo/outbound`, { method: "POST", headers: auth, body: JSON.stringify({ leadId: OK_LEAD, language: "en" }) });
      const dialled = apiCalls.find((c) => c.url.endsWith("/Call/"));
      ok(r.status === 202 && !!dialled && /^\+\d{10,}$/.test(dialled.body.to) && dialled.body.answer_url.startsWith(`${SERVICE}/plivo/answer?`), "an allowed lead is dialled through the carrier, with our answer address", `${r.status} to ${dialled?.body?.to}`);
      // the carrier calls the answer address once the person picks up
      const u = new URL(dialled!.body.answer_url), ps = { CallUUID: `sim-out-${Date.now()}`, From: "+918000000000", To: dialled!.body.to, Direction: "outbound" };
      const sg = signed(u.pathname + u.search, ps);
      const a2 = await (await fetch(sg.url, { method: "POST", headers: sg.headers, body: sg.body })).text();
      ok(a2.includes("direction=outbound") && a2.includes(`lead=${OK_LEAD}`), "when the person answers, the call opens a stream marked as outbound for that lead");
    }
  }
  api.close();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error("phone simulator crashed:", e); process.exit(2); });
