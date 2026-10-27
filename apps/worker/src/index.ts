/**
 * Post-call worker (Phase 4). Looks for finished calls that have a transcript but no insights, asks the AI to analyse each, and saves the
 * result: summary, sentiment, intent, next action, and the lead-status and Do Not Disturb rules (see packages/db/src/post-call.ts).
 * It polls the database instead of using a queue server, so it needs nothing but the database and the AI.
 *
 *   pnpm --filter @voiceai/worker dev          runs forever
 *   pnpm --filter @voiceai/worker once         handles what is waiting, then exits (for tests and cron)
 */
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { createDb, listExpiredRecordings, listExpiredTranscripts, listPendingAnalysis, loadCallForAnalysis, purgeRecording, purgeTranscript, recordAnalysisFailure, saveAnalysis } from "@voiceai/db";
import { createAskG1, type LlmAdapter } from "@voiceai/providers";
import { analyzeCall } from "./analyze";

try { process.loadEnvFile(join(fileURLToPath(new URL("..", import.meta.url)), ".env.local")); } catch { /* keys can also come from the real environment */ }
const env = (k: string) => process.env[k]?.trim() || undefined;
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

const once = process.argv.includes("--once");
const { db } = createDb(env("DATABASE_URL") ?? (() => { throw new Error("DATABASE_URL is not set"); })());

/** AskG1 first; the local backup model when AskG1 cannot answer. Returns the name of the model that answered, for the record. */
const askg1 = env("ASKG1_API_KEY") && env("ASKG1_BASE_URL")
  ? createAskG1({ apiKey: env("ASKG1_API_KEY")!, baseUrl: env("ASKG1_BASE_URL")!, model: env("ASKG1_MODEL"), maxTokens: 500, temperature: 0, responseTimeoutMs: 30_000 }) : null;
const local = env("LOCAL_LLM_URL") ? createAskG1({ apiKey: "local", baseUrl: env("LOCAL_LLM_URL")!, model: "local", maxTokens: 500, temperature: 0, responseTimeoutMs: 60_000 }) : null;
if (!askg1 && !local) throw new Error("No AI is configured (ASKG1_API_KEY and ASKG1_BASE_URL, or LOCAL_LLM_URL)");
const llmFor = (note: { used: string }): LlmAdapter => ({
  respond: () => (async function* () {})(),
  async *chat(input) {
    if (askg1) {
      try { let any = false; for await (const t of askg1.chat(input)) { any = true; note.used = `askg1:${env("ASKG1_MODEL") ?? "g1-chat"}`; yield t; } if (any) return; }
      catch (e) { if (!local) throw e; log(`AskG1 did not answer (${e instanceof Error ? e.message : e}); using the local model`); }
    }
    if (!local) throw new Error("AskG1 returned nothing");
    note.used = "local:llama-3.2-3b";
    yield* local.chat(input);
  },
});

async function handleOne(p: { callLogId: string; orgId: string }) {
  try {
    const call = await loadCallForAnalysis(db, p);
    if (!call) return;
    const note = { used: "" };
    const analysis = await analyzeCall(call, llmFor(note));
    const r = await saveAnalysis(db, p, analysis, note.used || "unknown");
    log(`call ${p.callLogId.slice(0, 8)} ${r.rerun ? "re-analysed" : "analysed"} by ${note.used}: ${analysis.sentimentLabel}, ${analysis.intent ?? "no intent"}${analysis.suggestedStatus ? `, suggests ${analysis.suggestedStatus} (${Math.round((analysis.confidence ?? 0) * 100)}%) -> ${r.status}` : ""}${r.dndSet ? ", Do Not Disturb switched on" : ""}`);
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    log(`call ${p.callLogId.slice(0, 8)} could not be analysed: ${why}`);
    await recordAnalysisFailure(db, p, why).catch((x) => log(`could not record the failure: ${x instanceof Error ? x.message : x}`));
  }
}

/** Recording files live in a folder on this machine (RECORDINGS_DIR, the same one the website writes to). A missing file is fine: the goal is that it is gone. */
const recordingsRoot = resolve(env("RECORDINGS_DIR") ?? join(fileURLToPath(new URL("../../..", import.meta.url)), ".local/recordings"));
async function deleteRecordingFile(key: string) {
  const path = resolve(recordingsRoot, key);
  if (!path.startsWith(recordingsRoot + sep)) throw new Error("recording key points outside the recordings folder");
  await rm(path, { force: true });
}

/** Retention (SOP): each organisation chooses how long recordings and transcripts are kept. Runs once an hour, a batch at a time. */
async function purgeExpired() {
  let recordings = 0, transcripts = 0;
  for (const r of await listExpiredRecordings(db, 200)) {
    try { await deleteRecordingFile(r.recordingKey); if (await purgeRecording(db, r)) recordings++; }
    catch (e) { log(`could not purge a recording: ${e instanceof Error ? e.message : e}`); }
  }
  for (const t of await listExpiredTranscripts(db, 200)) {
    try { if (await purgeTranscript(db, t)) transcripts++; } catch (e) { log(`could not purge a transcript: ${e instanceof Error ? e.message : e}`); }
  }
  if (recordings || transcripts) log(`retention: removed ${recordings} recording(s) and ${transcripts} transcript(s) past their retention period`);
}

const PARALLEL = Math.max(1, Math.min(8, Number(env("WORKER_PARALLEL") ?? 3)));
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });
log(`post-call worker started (${askg1 ? "AskG1" : "no AskG1"}${local ? " + local backup" : ""}, ${PARALLEL} calls at a time)`);
let lastPurge = 0;
do {
  if (Date.now() - lastPurge > 3_600_000) { lastPurge = Date.now(); await purgeExpired().catch((e) => log(`retention run failed: ${e instanceof Error ? e.message : e}`)); }
  let pending: Awaited<ReturnType<typeof listPendingAnalysis>> = [];
  try { pending = await listPendingAnalysis(db, PARALLEL * 2); } catch (e) { log(`could not read the queue: ${e instanceof Error ? e.message : e}`); }
  // Several calls at once: each is mostly waiting for the AI, so this multiplies throughput without more machines.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, pending.length) }, async () => { while (!stopping && next < pending.length) await handleOne(pending[next++]!); }));
  if (once && pending.length === 0) break;
  if (!stopping && pending.length === 0) await new Promise((r) => setTimeout(r, 5000));
} while (!stopping);
log("post-call worker stopped");
process.exit(0);
