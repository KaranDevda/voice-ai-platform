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
import { campaignTick, createDb, crmClaim, crmDone, dialToken, heartbeat, lowBalanceDue, lowBalanceSent, smsDone, smsRound, listExpiredRecordings, listExpiredTranscripts, listPendingAnalysis, loadCallForAnalysis, purgeRecording, purgeTranscript, recordAnalysisFailure, reportDial, saveAnalysis } from "@voiceai/db";
import { createAskG1, createPlivo, S3Recordings, sendCrmWebhook, sendEmail, smtpFromEnv, type LlmAdapter } from "@voiceai/providers";
import { analyzeCall } from "./analyze";
import { renderTemplate } from "@voiceai/shared";

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
/** With RECORDINGS_BUCKET set (the same variable the website uses) they live in S3 instead. */
const s3 = env("RECORDINGS_BUCKET") ? new S3Recordings({ bucket: env("RECORDINGS_BUCKET")!, region: env("RECORDINGS_REGION") ?? "ap-south-1", endpoint: env("RECORDINGS_S3_ENDPOINT") }) : null;
async function deleteRecordingFile(key: string) {
  if (s3) return s3.remove(key);
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

/**
 * Outbound campaigns. Every few seconds: start campaigns whose time has come, settle finished calls (answered = done, otherwise try again
 * after the delay, up to the limit), and ask the voice service to dial the next people, never more at once than the campaign allows.
 * The voice service still applies Do Not Disturb, consent and the calling hours (9:00 to 21:00 India time) before it dials.
 * Needs VOICE_TOKEN_SECRET (or SESSION_SECRET, the same one the voice service uses) and VOICE_SERVICE_URL. Run ONE worker.
 */
const voiceUrl = (env("VOICE_SERVICE_URL") ?? "http://127.0.0.1:4001").replace(/\/$/, "");
const campaignKey = env("VOICE_TOKEN_SECRET") ?? env("SESSION_SECRET");
if (!campaignKey) log("campaigns are off: set VOICE_TOKEN_SECRET (or SESSION_SECRET) so the runner can ask the voice service to dial");
async function runCampaigns() {
  for (const job of await campaignTick(db, 10)) {
    const tag = `campaign ${job.campaignId.slice(0, 8)} lead ${job.leadId.slice(0, 8)}`;
    try {
      const res = await fetch(`${voiceUrl}/plivo/outbound`, {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${dialToken(job, campaignKey!)}` },
        body: JSON.stringify({ leadId: job.leadId, language: job.language, opening: job.opening ?? undefined, detectMachines: job.detectMachines, campaignAudio: job.mode === "audio" ? job.campaignId : undefined }), signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 202) { log(`${tag}: dialling`); continue; }
      const b = (await res.json().catch(() => ({}))) as { error?: string; reason?: string };
      if (res.status === 409) { log(`${tag}: not dialled (${b.reason ?? "blocked"})`); await reportDial(db, job.targetId, b.reason === "outside_hours" || b.reason === "no_credit" ? "hours" : "skip", b.reason ?? "blocked"); }
      else { log(`${tag}: voice service answered ${res.status} ${b.error ?? ""}`); await reportDial(db, job.targetId, "failed", `voice service answered ${res.status}${b.error ? ` (${b.error})` : ""}`); }
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      log(`${tag}: could not reach the voice service: ${why}`);
      await reportDial(db, job.targetId, "failed", `could not reach the voice service: ${why}`).catch(() => {});
    }
  }
}

/**
 * Texts. Every few seconds: follow-up steps that are due become queued texts, then queued texts are sent through Plivo (only inside the
 * calling hours, never to Do Not Disturb). Needs PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN and PLIVO_SMS_SENDER (an approved sender ID or number);
 * for India also PLIVO_DLT_ENTITY_ID, and each text should carry its DLT template ID. Run ONE worker.
 */
const plivoSms = env("PLIVO_AUTH_ID") && env("PLIVO_AUTH_TOKEN") && env("PLIVO_SMS_SENDER") ? createPlivo({ authId: env("PLIVO_AUTH_ID")!, authToken: env("PLIVO_AUTH_TOKEN")!, baseUrl: env("PLIVO_API_BASE") }) : null;
if (!plivoSms) log("texts are off: set PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN and PLIVO_SMS_SENDER to send SMS");
async function runSms() {
  for (const m of await smsRound(db, 20)) {
    try {
      const { messageUuid } = await plivoSms!.sendSms({ from: env("PLIVO_SMS_SENDER")!, to: m.phone, text: renderTemplate(m.body, { name: m.personName, fields: m.personFields }), dltEntityId: env("PLIVO_DLT_ENTITY_ID"), dltTemplateId: m.dltTemplateId ?? undefined });
      await smsDone(db, m.id, true, messageUuid);
      log(`text ${m.id.slice(0, 8)} sent`);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      log(`text ${m.id.slice(0, 8)} failed: ${why}`);
      await smsDone(db, m.id, false, undefined, why).catch(() => {});
    }
  }
}

/** CRM webhooks: deliveries that are due are sent, signed; failures are retried later (1 min, 5 min, 30 min, 2 h, 12 h, 12 h). */
async function runCrm() {
  const jobs = await crmClaim(db, 20);
  await Promise.all(jobs.map(async (j) => {
    const r = await sendCrmWebhook({ id: j.id, event: j.event, payload: j.payload, url: j.url, secret: j.secret });
    await crmDone(db, j.id, r.ok, r.status, r.error);
    log(`webhook ${j.id.slice(0, 8)} ${j.event}: ${r.ok ? "delivered" : `failed (${r.error}), attempt ${j.attempts}`}`);
  }));
}

/**
 * Low-balance alerts: an organisation with billing on that has set a limit in Settings gets one e-mail to its admins when its credit falls under
 * it, and another only after it has added credit and dropped under again. Needs the e-mail settings (SMTP_*); without them nothing is sent or marked.
 */
const smtp = smtpFromEnv();
const rupees = (paise: number) => `Rs ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
async function runLowBalance() {
  if (!smtp) return;
  for (const j of await lowBalanceDue(db, 20)) {
    if (j.emails.length === 0) { log(`low balance for ${j.orgName}: no admin e-mail to tell`); await lowBalanceSent(db, j.orgId); continue; }
    const link = `${(env("APP_URL") ?? "http://localhost:3000").replace(/\/$/, "")}/billing`;
    try {
      for (const to of j.emails) await sendEmail(smtp, { to, subject: `Low credit balance: ${rupees(j.balancePaise)} left`, text: `Hello,\n\nThe credit balance of ${j.orgName} is ${rupees(j.balancePaise)}, under the ${rupees(j.thresholdPaise)} limit set in Settings.\n\nAdd credit here: ${link}\n\nCalls and texts stop at zero if "refuse at zero credit" is on.` });
      await lowBalanceSent(db, j.orgId);
      log(`low balance e-mail sent for ${j.orgName} (${j.emails.length})`);
    } catch (e) { log(`low balance e-mail for ${j.orgName} failed: ${e instanceof Error ? e.message : e}`); }
  }
}

const PARALLEL = Math.max(1, Math.min(8, Number(env("WORKER_PARALLEL") ?? 3)));
let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => { stopping = true; });
log(`post-call worker started (${askg1 ? "AskG1" : "no AskG1"}${local ? " + local backup" : ""}, ${PARALLEL} calls at a time)`);
let lastPurge = 0, lastCampaignRound = 0, lastSmsRound = 0, lastCrmRound = 0, lastLowBalance = 0;
do {
  if (Date.now() - lastPurge > 3_600_000) { lastPurge = Date.now(); await purgeExpired().catch((e) => log(`retention run failed: ${e instanceof Error ? e.message : e}`)); }
  if (campaignKey && Date.now() - lastCampaignRound > 5000) { lastCampaignRound = Date.now(); await runCampaigns().then(() => heartbeat(db, "campaign runner", true), (e) => { log(`campaign round failed: ${e instanceof Error ? e.message : e}`); return heartbeat(db, "campaign runner", false, String(e instanceof Error ? e.message : e)); }).catch(() => {}); }
  if (plivoSms && Date.now() - lastSmsRound > 5000) { lastSmsRound = Date.now(); await runSms().then(() => heartbeat(db, "text sender", true), (e) => { log(`text round failed: ${e instanceof Error ? e.message : e}`); return heartbeat(db, "text sender", false, String(e instanceof Error ? e.message : e)); }).catch(() => {}); }
  if (Date.now() - lastCrmRound > 5000) { lastCrmRound = Date.now(); await runCrm().then(() => heartbeat(db, "CRM webhooks", true), (e) => { log(`webhook round failed: ${e instanceof Error ? e.message : e}`); return heartbeat(db, "CRM webhooks", false, String(e instanceof Error ? e.message : e)); }).catch(() => {}); }
  if (smtp && Date.now() - lastLowBalance > 600_000) { lastLowBalance = Date.now(); await runLowBalance().then(() => heartbeat(db, "low balance alerts", true), (e) => { log(`low balance round failed: ${e instanceof Error ? e.message : e}`); return heartbeat(db, "low balance alerts", false, String(e instanceof Error ? e.message : e)); }).catch(() => {}); }
  let pending: Awaited<ReturnType<typeof listPendingAnalysis>> = [];
  try { pending = await listPendingAnalysis(db, PARALLEL * 2); await heartbeat(db, "call analysis", true); } catch (e) { log(`could not read the queue: ${e instanceof Error ? e.message : e}`); await heartbeat(db, "call analysis", false, String(e instanceof Error ? e.message : e)).catch(() => {}); }
  // Several calls at once: each is mostly waiting for the AI, so this multiplies throughput without more machines.
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLEL, pending.length) }, async () => { while (!stopping && next < pending.length) await handleOne(pending[next++]!); }));
  if (once && pending.length === 0) break;
  if (!stopping && pending.length === 0) await new Promise((r) => setTimeout(r, 5000));
} while (!stopping);
log("post-call worker stopped");
process.exit(0);
