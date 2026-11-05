/**
 * Accuracy of an AI model on questions your own knowledge base can answer, using the same instruction, the same knowledge lookup and the same
 * reply limits as a real call. Each answer is checked for the facts it must contain and for numbers it invented. Two questions have no answer in the
 * knowledge base on purpose: a good answer says it does not have the information (or offers a person) and invents nothing.
 *
 *   pnpm --filter @voiceai/voice exec tsx src/llm-accuracy.ts -- --model llama      (the local Llama server on :8090)
 *   pnpm --filter @voiceai/voice exec tsx src/llm-accuracy.ts -- --model askg1      (needs ASKG1_* in .env.local)
 * Options: --org <uuid>  --json <file>
 */
import { writeFileSync } from "node:fs";
import { createDb, searchKnowledge } from "@voiceai/db";
import { createAskG1 } from "@voiceai/providers";
import { sessionLanguageRule } from "./language";
import { knowledgeBlock, voiceRulesFor } from "./prompt";
import { hindiToEnglishKeywords, relevantExcerpt } from "./knowledge";

try { process.loadEnvFile(".env.local"); } catch { /* keys can also come from the real environment */ }
const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback; };
const MODEL = arg("model", "llama");
const ORG_PROMPT = "You are a helpful, concise phone assistant. Answer only from the knowledge base."; // the default in Settings
const JSON_OUT = arg("json", "");

interface Q { lang: "en" | "hi"; q: string; must: RegExp[]; trap?: boolean; why: string }
const NUM4999 = /4[,.]?999|४९९९|चार हज़ार नौ सौ निन्यानवे|चार हजार नौ सौ निन्यानवे/;
const QUESTIONS: Q[] = [
  { lang: "en", q: "How much does the Starter plan cost?", must: [/1[,.]?999/], why: "Starter price" },
  { lang: "en", q: "What is the price of the Business plan and how many users does it include?", must: [/4[,.]?999/, /\b10\b|ten/i], why: "Business price and users" },
  { lang: "en", q: "Is there a discount if I pay yearly?", must: [/15/], why: "annual discount" },
  { lang: "en", q: "What do I get with the Enterprise plan?", must: [/single sign|SSO/i, /request/i], why: "enterprise" },
  { lang: "en", q: "How long do you keep my call recordings?", must: [/180/], why: "recording retention" },
  { lang: "en", q: "And how long are transcripts kept?", must: [/one year|1 year|12 months|a year/i], why: "transcript retention" },
  { lang: "en", q: "Where is my data stored?", must: [/india/i], why: "data location" },
  { lang: "en", q: "How often do calls from the agent app sync?", must: [/two minutes|2 minutes|every 2/i], why: "sync interval" },
  { lang: "en", q: "Why are some calls on Android not recorded?", must: [/android 10|android/i, /dialer|record/i], why: "Android recording" },
  { lang: "en", q: "What happens to a cloned voice if the person withdraws consent?", must: [/24 hours|twenty-four|within a day/i], why: "clone deletion" },
  { lang: "hi", q: "बिज़नेस प्लान की कीमत क्या है?", must: [NUM4999], why: "Hindi: Business price" },
  { lang: "hi", q: "रिकॉर्डिंग कितने दिन तक रखी जाती है?", must: [/180|एक सौ अस्सी|१८०/], why: "Hindi: recording retention" },
  { lang: "hi", q: "स्टार्टर प्लान में कितने यूज़र मिलते हैं?", must: [/3|तीन|३/], why: "Hindi: Starter users" },
  { lang: "hi", q: "मेरा डेटा कहाँ स्टोर होता है?", must: [/भारत|इंडिया|India/i], why: "Hindi: data location" },
  { lang: "en", q: "Do you offer a free trial?", must: [], trap: true, why: "not in the knowledge base" },
  { lang: "en", q: "Which payment methods do you accept?", must: [], trap: true, why: "not in the knowledge base" },
];
const NOT_KNOWN = /(do not|don't|doesn't|does not|not) (have|know|see|find)|no (information|details)|not sure|cannot (say|confirm)|can't (say|confirm)|connect you|colleague|team member|a person|मेरे पास.*(नहीं|जानकारी)|जानकारी.*नहीं|साथी|टीम/i;

const { db, pool } = createDb(process.env.DATABASE_URL ?? (() => { throw new Error("DATABASE_URL is not set"); })());
const ORG = arg("org", "1f927c2b-598f-4ab7-80be-db3598f5e4f8");
const user = { id: "00000000-0000-4000-8000-000000000001", orgId: ORG, teamIds: [] as string[], permissions: ["kb.read"] } as never;
/** Everything the knowledge base returned for any question so far: a number in an answer that is in none of it (nor in the question) was invented. */
let kbText = "";

const llm = MODEL === "askg1"
  ? createAskG1({ apiKey: process.env.ASKG1_API_KEY!, baseUrl: process.env.ASKG1_BASE_URL!, model: process.env.ASKG1_MODEL, maxTokens: 220, temperature: 0.3, responseTimeoutMs: 90_000 })
  : createAskG1({ apiKey: "local", baseUrl: process.env.LOCAL_LLM_URL ?? "http://127.0.0.1:8090", model: "local", maxTokens: 220, temperature: 0.3, responseTimeoutMs: 60_000 });

/** Numbers of two digits or more (commas allowed) that are neither in the knowledge base nor in the question: invented. */
function inventedNumbers(answer: string, question: string): string[] {
  const known = `${kbText} ${question}`.replace(/,/g, "");
  return (answer.replace(/(\d),(\d)/g, "$1$2").match(/\d{2,}/g) ?? []).filter((n) => !known.includes(n));
}

const results: { q: string; a: string; ok: boolean; missing: string[]; invented: string[]; firstMs: number; totalMs: number }[] = [];
for (const item of QUESTIONS) {
  const query = hindiToEnglishKeywords(item.q);
  const hits = query ? await searchKnowledge(db, user, query, 2) : [];
  kbText += ` ${hits.map((r) => r.content).join(" ")}`;
  const found = hits.map((r) => `${r.title}: ${relevantExcerpt(r.content, query)}`);
  // Exactly what a call with a signed-in organisation sends: the organisation's own instruction (Settings default), the voice rules ONCE, and the language rule.
  const system = `${ORG_PROMPT}\n\n${voiceRulesFor(item.lang)}${sessionLanguageRule(item.lang)}`;
  const messages = [{ role: "system" as const, content: system }, { role: "user" as const, content: `${item.q}\n[note: ${knowledgeBlock(found)}]` }];
  const t0 = performance.now(); let first = 0, answer = "";
  try { for await (const t of llm.chat({ messages, signal: AbortSignal.timeout(100_000) })) { if (!first) first = performance.now() - t0; answer += t; } } catch (e) { answer = `(error: ${e instanceof Error ? e.message : e})`; }
  const total = performance.now() - t0, text = answer.replace(/\s+/g, " ").trim();
  const missing = item.trap ? (NOT_KNOWN.test(text) ? [] : ["did not say it lacks the information"]) : item.must.filter((m) => !m.test(text)).map(String);
  const invented = inventedNumbers(text, item.q);
  const ok = missing.length === 0 && invented.length === 0;
  results.push({ q: item.q, a: text, ok, missing, invented, firstMs: first, totalMs: total });
  console.log(`${ok ? "PASS" : "FAIL"} ${(first / 1000).toFixed(2)}s | ${item.q} -> ${text.slice(0, 150)}${missing.length ? `\n      missing: ${missing.join(", ")}` : ""}${invented.length ? `\n      invented numbers: ${invented.join(", ")}` : ""}`);
}
const n = results.length, pass = results.filter((r) => r.ok).length, inv = results.filter((r) => r.invented.length).length;
const med = (x: number[]) => [...x].sort((a, b) => a - b)[Math.floor(x.length / 2)]!;
console.log(`\n${MODEL}: ${pass}/${n} correct (${Math.round((100 * pass) / n)}%) | answers with invented numbers: ${inv} | median first word ${(med(results.map((r) => r.firstMs)) / 1000).toFixed(2)} s, median full answer ${(med(results.map((r) => r.totalMs)) / 1000).toFixed(2)} s`);
console.log(`English ${results.filter((_, i) => QUESTIONS[i]!.lang === "en" && !QUESTIONS[i]!.trap).filter((r) => r.ok).length}/${QUESTIONS.filter((q) => q.lang === "en" && !q.trap).length} | Hindi ${results.filter((_, i) => QUESTIONS[i]!.lang === "hi").filter((r) => r.ok).length}/${QUESTIONS.filter((q) => q.lang === "hi").length} | not-in-knowledge questions handled ${results.filter((_, i) => QUESTIONS[i]!.trap).filter((r) => r.ok).length}/${QUESTIONS.filter((q) => q.trap).length}`);
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ model: MODEL, pass, n, results }, null, 1));
await pool.end();
