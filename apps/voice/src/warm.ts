/**
 * Warms the voices so the first real caller does not wait: for each staff voice, in Hindi and Hinglish, it opens one session, lets the
 * greeting play and closes it. That makes the greeting and the acknowledgements once (Hindi voice, voice conversion) and starts AskG1's
 * prompt cache, so the next caller hears them from memory.
 *
 *   pnpm --filter @voiceai/voice warm -- --voices "profile:<id>,profile:<id>"
 * Needs the voice service and the local speech servers (pnpm dev:stack). The stack runs it by itself after start-up.
 */
import { signVoiceToken } from "@voiceai/auth";
import WebSocket from "ws";

try { process.loadEnvFile(".env.local"); } catch { /* the secret can also come from the real environment */ }
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback; };
const URL_ = arg("url", `ws://127.0.0.1:${process.env.PORT ?? 4001}/stream`);
const ORG = arg("org", "1f927c2b-598f-4ab7-80be-db3598f5e4f8");
const SUB = arg("sub", "00000000-0000-4000-8000-000000000001");
const KEY = process.env.VOICE_TOKEN_SECRET?.trim() || process.env.SESSION_SECRET?.trim();
if (!KEY) { console.error("Set SESSION_SECRET in apps/voice/.env.local"); process.exit(2); }
const VOICES = arg("voices", "").split(",").filter(Boolean);
if (!VOICES.length) { console.error('Give --voices "profile:<id>,profile:<id>"'); process.exit(2); }

function warm(voice: string, language: "hi" | "en-hi"): Promise<string> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ws = new WebSocket(`${URL_}?token=${encodeURIComponent(signVoiceToken({ sub: SUB, org: ORG }, KEY!, 300))}`, { headers: { origin: arg("origin", "http://localhost:3000") } });
    let spoke = false;
    const done = (note: string) => { clearTimeout(limit); try { ws.close(); } catch { /* already closed */ } resolve(`${voice} ${language}: ${note} (${((Date.now() - t0) / 1000).toFixed(1)} s)`); };
    const limit = setTimeout(() => done("timed out"), 45_000);
    ws.on("open", () => ws.send(JSON.stringify({ type: "start", language, voice, greeting: true, listen: "anyone" })));
    ws.on("message", (d, bin) => {
      if (bin) return;
      const m = JSON.parse(String(d)) as { type: string; state?: string; message?: string };
      if (m.type === "state" && m.state === "speaking") spoke = true;
      if (m.type === "state" && m.state === "listening" && spoke) done("warm");
      if (m.type === "error" || m.type === "blocked") done(`failed: ${m.message ?? m.type}`);
    });
    ws.on("error", (e) => done(`failed: ${e.message}`));
  });
}

for (const v of VOICES) for (const l of ["hi", "en-hi"] as const) console.log(await warm(v, l));
