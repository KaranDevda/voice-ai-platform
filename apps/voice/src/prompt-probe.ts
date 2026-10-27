// How does AskG1's time to first word depend on the size of the instruction? Uses the real prompt strings, never printed.
import { SYSTEM_PROMPT, VOICE_RULES, knowledgeBlock } from "./prompt";
try { process.loadEnvFile(".env.local"); } catch {}
const B = process.env.ASKG1_BASE_URL!.trim(), K = process.env.ASKG1_API_KEY!.trim(), M = (process.env.ASKG1_MODEL ?? "g1-chat").trim();
const KNOW = knowledgeBlock(["Pricing: The Business plan costs 4,999 rupees per month and includes up to 10 users, call recording for 30 days and AI call summaries. The Starter plan costs 1,999 rupees per month for up to 3 users."]);
const NOTE = "\n\nThe caller is speaking Hindi. Reply in Hindi only, written in Devanagari script.";
const variants: Array<[string, string]> = [
  ["tiny (one line)", "You are a phone assistant. Reply in one or two short sentences."],
  ["rules only (no examples)", SYSTEM_PROMPT.slice(0, 1200)],
  ["full instruction, no knowledge", SYSTEM_PROMPT],
  ["full instruction + knowledge + language note (what a real turn sends)", SYSTEM_PROMPT + KNOW + NOTE],
];
const Q = ["बिज़नेस प्लान की कीमत क्या है?", "What is the price of the business plan?"];
async function once(system: string, q: string): Promise<number> {
  const t0 = performance.now();
  const r = await fetch(`${B}/v1/chat/completions`, { method: "POST", headers: { authorization: `Bearer ${K}`, "content-type": "application/json" }, body: JSON.stringify({ model: M, stream: true, max_tokens: 160, temperature: 0.3, messages: [{ role: "system", content: system }, { role: "user", content: q }] }) });
  const reader = r.body!.getReader(), dec = new TextDecoder();
  for (;;) { const { value, done } = await reader.read(); if (done) return NaN; if (/"content":"[^"]/.test(dec.decode(value))) { void reader.cancel(); return performance.now() - t0; } }
}
const med = (x: number[]) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)]!;
for (const [name, sys] of variants) {
  const t: number[] = [];
  for (let i = 0; i < 6; i++) t.push(await once(sys + (i % 2 ? "" : " "), Q[i % 2]!)); // a trailing space on some, so a cached prefix cannot make all runs look alike
  console.log(`${name.padEnd(72)} ${String(sys.length).padStart(6)} chars   first text: median ${(med(t) / 1000).toFixed(2)} s, slowest ${(Math.max(...t) / 1000).toFixed(2)} s`);
}
