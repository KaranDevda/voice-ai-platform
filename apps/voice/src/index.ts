import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { z } from "zod";
import { signVoiceToken, verifyVoiceToken, type AuthUser, type VoiceTokenClaims } from "@voiceai/auth";
import { CALL_BLOCK_MESSAGES, normalizePhone } from "@voiceai/shared";
import { checkOutboundCall, createDb, getVoiceSampleForEngine, findLeadIdByPhone, getAgentConfig, getLeadPhone, getPhoneConfig, getSmsSettings, loadAuthUser, queueSmsToLead, recordInboundSms, reportMachine, sentTextRecently, saveAiCall, resolveCallVoice, searchKnowledge, type Db } from "@voiceai/db";
import {
  createAskG1, createDeepgramLive, createPlivo, parsePlivoStreamMessage, plivoClearAudio, plivoDialXml, plivoHangupXml, plivoMenuXml, plivoPlayAudio, plivoStreamXml, verifyPlivoSignature, createDeepgramTts, createElevenLabsTts, createLocalWhisper, createPocketTts, mulawToPcm16, isBuiltInPocketVoice, signVoiceFileId,
  kokoroHindiVoiceFor, stockVoiceById, voiceFileStem, type LlmAdapter, type PocketLanguage, type SttAdapter,
} from "@voiceai/providers";
import { chatterboxEngine, elevenLabsPcmEngine, mulawAdapterAsPcm, mulawAdapterEngine, pocketMulawEngine, pocketPcmEngine, withProsody } from "./engines";
import { MulawTo16k } from "./telephony-audio";
import { hindiToEnglishKeywords, relevantExcerpt } from "./knowledge";
import { languageNote, sessionLanguageRule } from "./language";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { allowedOrigins, originAllowed } from "./origins";
import { HANDOFF_HINDI } from "./handoff";
import { withFailover } from "./llm-failover";
import { speakerNote, type Gender } from "./gender";
import { Conversation, primeAck, type ServerEvent, type TtsEngine } from "./pipeline";
import { ackFor } from "./ack";
import { FALLBACK, FALLBACK_HI, GREETING, GREETING_HI, GREETING_HINGLISH, systemPromptFor, voiceRulesFor } from "./prompt";

// Paths are relative to this file, never to the folder the service was started from: starting it from the wrong folder used to run it
// without its keys or voice files.
const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const REPO_DIR = fileURLToPath(new URL("../../..", import.meta.url));
try { process.loadEnvFile(join(APP_DIR, ".env.local")); } catch { /* keys can also come from the real environment */ }
const env = (k: string) => process.env[k]?.trim() || undefined;

const PORT = Number(env("PORT") ?? 4001);
const TOKEN_KEY = env("VOICE_TOKEN_SECRET") ?? env("SESSION_SECRET");
const FILE_KEY = env("VOICE_FILE_SECRET") ?? env("SESSION_SECRET");
const ORIGINS = allowedOrigins(env("WEB_ORIGIN"));
/**
 * Where clone voice files are fetched from: the web app. WEB_BASE_URL if set, otherwise the first allowed address that
 * answers (the web app may be on port 3000 or 3001). Looked up once per call so a restarted web app is found.
 */
let webBase = (env("WEB_BASE_URL") ?? "http://localhost:3000").replace(/\/$/, "");
async function findWebBase(): Promise<void> {
  if (env("WEB_BASE_URL")) return;
  for (const o of ORIGINS) {
    if (await fetch(`${o}/login`, { method: "HEAD", signal: AbortSignal.timeout(800) }).then((r) => r.ok, () => false)) { webBase = o; return; }
  }
}
const MAX_SESSIONS = Number(env("MAX_SESSIONS") ?? 20);
const MAX_CALL_MS = Number(env("MAX_CALL_MINUTES") ?? 15) * 60_000;
const MAX_FRAME = 64 * 1024;

let db: Db | null = null;
const getDb = () => (db ??= createDb(env("DATABASE_URL") ?? (() => { throw new Error("DATABASE_URL is not set"); })()).db);

type Say = (e: ServerEvent) => void;

/** One TTS client per call, so a "this voice has no Hindi yet" warning reaches the right caller. */
const pocket = (say?: Say) => {
  const baseUrl = env("POCKET_TTS_URL");
  if (!baseUrl) throw new Error("POCKET_TTS_URL is not set (run pnpm dev:tts)");
  const kokoro = env("KOKORO_URL");
  const hi = kokoro ? undefined : env("POCKET_TTS_HI_URL");
  const fileUrl = (id: string, l: PocketLanguage) => {
    const stem = voiceFileStem(id, l);
    return `${webBase}/api/internal/voice-files/${signVoiceFileId(FILE_KEY ?? "", stem)}/${stem}.safetensors`;
  };
  return createPocketTts({
    baseUrl,
    kokoro: kokoro ? { baseUrl: kokoro } : undefined,
    convert: kokoro && env("VOICE_CONVERT_URL") ? { baseUrl: env("VOICE_CONVERT_URL")! } : undefined,
    onNotConverted: (_id, why) => say?.({ type: "notice", message: why === "no_fingerprint" ? "This voice has no voice fingerprint yet, so Hindi is spoken in the built-in Hindi voice. Clone it again, or use Add Hindi to an existing voice." : "The voice-conversion server is not answering, so Hindi is spoken in the built-in Hindi voice. Start it with pnpm dev:stack." }),
    languages: hi ? { hi: { baseUrl: hi, exportArgs: [] } } : undefined,
    voiceUrl: fileUrl,
    voiceAvailable: async (id, l) => (await fetch(fileUrl(id, l), { method: "HEAD", signal: AbortSignal.timeout(3000) })).ok,
    onVoiceMissing: (_id, l) => say?.({ type: "notice", message: `This voice has no ${l === "hi" ? "Hindi" : l} version yet, so a default ${l === "hi" ? "Hindi" : l} voice is speaking. Record the person again under Voice clone to add it.` }),
  });
};

/**
 * Who the AI listens to (local speech-to-text only):
 *  - close:  the person at the microphone. Quieter voices further away are ignored. Best in a room with other people.
 *  - anyone: every voice it can hear. Fine in a quiet room alone.
 *  - push:   only while the page is holding the talk button; the page sends silence otherwise.
 */
export type ListenMode = "close" | "anyone" | "push";

const nameHints = () => (env("STT_NAME_HINTS") ?? "").split(",").map((n) => n.trim()).filter(Boolean).slice(0, 40).join(", ");

/** Local Whisper when it is set up (free, on this machine); otherwise Deepgram's cloud. */
function sttFor(listen: ListenMode, language: "en" | "hi" | "en-hi", log?: (line: string) => void): SttAdapter {
  // English calls can use a small English-only model (WHISPER_URL_EN): about five times faster to decode, but weaker on strong accents.
  const whisper = (language === "en" && env("WHISPER_URL_EN")) || env("WHISPER_URL");
  // STT_HINDI=deepgram sends Hindi and mixed-language calls to Deepgram (nova-3 hears Hindi well and answers in about 0.3 s); English stays on the local model.
  const viaDeepgram = env("STT_PROVIDER") === "deepgram" || (env("STT_HINDI") === "deepgram" && language !== "en");
  if (!viaDeepgram && whisper) {
    const endSilenceMs = Number(env("ENDPOINTING_MS") ?? 400);
    return createLocalWhisper({
      baseUrl: whisper,
      // A higher bar and a longer onset in "close" mode, so a nearby conversation does not start the AI talking or stop it.
      vad: listen === "close" ? { endSilenceMs, floor: 0.03, startMs: 200, minSpeechMs: 400 } : { endSilenceMs },
      closeMic: listen === "close" ? {} : undefined,
      // Names the recogniser has never heard (staff, products, places) written the way they should come out: STT_NAME_HINTS="Rohan Mehta, Sunita Sharma, रोहन मेहता".
      names: nameHints() || undefined,
      minConfidence: listen === "close" ? { avgLogprob: -0.85, noSpeechProb: 0.5 } : undefined, // only consulted for quieter-than-usual speech, so normal answers stay fast
      onTranscribed: (i) => { log?.(i.dropped ? `ignored (${i.dropped})${i.avgLogprob !== undefined ? `, confidence ${i.avgLogprob.toFixed(2)}` : ""}` : `transcribed ${i.speechMs} ms of speech in ${i.ms} ms`); },
    });
  }
  const key = env("DEEPGRAM_API_KEY");
  if (!key) throw new Error("No speech-to-text is configured (set WHISPER_URL, or DEEPGRAM_API_KEY)");
  return createDeepgramLive({ apiKey: key, endpointingMs: Number(env("ENDPOINTING_MS") ?? 300) });
}

/**
 * AskG1 is the main model. LOCAL_LLM_URL (a llama.cpp server running Llama 3.2, or any OpenAI-compatible service such as OpenRouter: URL https://openrouter.ai/api, LOCAL_LLM_KEY, LOCAL_LLM_MODEL) is the backup: when AskG1 cannot be reached
 * or is too slow to start answering, the backup answers instead and the page is told, so nobody mistakes it for AskG1.
 */
const askg1Shared = { inFlight: 0, downUntil: 0 };
function llm(say?: Say, choice?: { model: "default" | "openrouter"; openrouterModel: string }): LlmAdapter {
  const apiKey = env("ASKG1_API_KEY"), baseUrl = env("ASKG1_BASE_URL"), localUrl = env("LOCAL_LLM_URL");
  const maxTokens = Number(env("ASKG1_MAX_TOKENS") ?? 220), temperature = Number(env("ASKG1_TEMPERATURE") ?? 0.3);
  const local = localUrl ? createAskG1({ apiKey: env("LOCAL_LLM_KEY") ?? "local", baseUrl: localUrl, model: env("LOCAL_LLM_MODEL") ?? "local", maxTokens, temperature }) : null;
  // The organisation chose another model (Settings -> AI assistant): OpenRouter, with the small local model as backup when there is one.
  if (choice?.model === "openrouter") {
    const orKey = env("OPENROUTER_API_KEY") ?? (localUrl?.includes("openrouter.ai") ? env("LOCAL_LLM_KEY") : undefined);
    if (!orKey) say?.({ type: "notice", message: "This organisation chose an OpenRouter model, but no OpenRouter key is set on the server, so the default AI is answering." });
    else {
      const main = createAskG1({ apiKey: orKey, baseUrl: env("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api", model: choice.openrouterModel, maxTokens, temperature, responseTimeoutMs: Number(env("OPENROUTER_FIRST_TRY_MS") ?? 10_000) });
      const backup = local && !localUrl?.includes("openrouter.ai") ? local : null;
      return backup ? withFailover(main, backup, { firstTokenTimeoutMs: Number(env("OPENROUTER_FIRST_TOKEN_TIMEOUT_MS") ?? 6000), onBackup: (why) => console.warn(`OpenRouter skipped (${why}); the local model answered`) }) : main;
    }
  }
  if (!apiKey || !baseUrl) {
    if (!local) throw new Error("AskG1 is not configured (ASKG1_API_KEY, ASKG1_BASE_URL)");
    say?.({ type: "notice", message: "AskG1 is not configured, so a small local model (Llama 3.2) is answering. It is less accurate than AskG1, especially in Hindi." });
    return local;
  }
  // AskG1 alone answers (no backup model), and it sometimes stalls for 10 to 30 s before recovering: wait for it instead of handing the call over.
  // A request that has not started after 12 s is sent again once (AskG1's stalls often clear within seconds), with 18 s more to start.
  const quick = createAskG1({ apiKey, baseUrl, model: env("ASKG1_MODEL"), maxTokens, temperature, responseTimeoutMs: Number(env("ASKG1_FIRST_TRY_MS") ?? 12_000) });
  const second = createAskG1({ apiKey, baseUrl, model: env("ASKG1_MODEL"), maxTokens, temperature, responseTimeoutMs: Number(env("ASKG1_SECOND_TRY_MS") ?? 18_000) });
  const askg1: LlmAdapter = {
    ...quick,
    async *chat(args) {
      let started = false;
      try { for await (const t of quick.chat(args)) { started = true; yield t; } return; } catch (e) { if (started || args.signal?.aborted) throw e; }
      console.warn("AskG1 did not start in time, asking again");
      yield* second.chat(args);
    },
  };
  if (!local) return askg1;
  let told = false;
  return withFailover(askg1, local, {
    firstTokenTimeoutMs: Number(env("ASKG1_FIRST_TOKEN_TIMEOUT_MS") ?? 8000),
    maxConcurrent: Number(env("ASKG1_MAX_CONCURRENT") ?? 3),
    shared: askg1Shared,
    onBackup: (why) => {
      console.warn(`AskG1 skipped (${why}); the local model answered`);
      if (told) return;
      told = true;
      say?.({ type: "notice", message: `AskG1 is not answering (${why}), so a small local model (Llama 3.2) is answering instead. It is less accurate than AskG1, especially in Hindi.` });
    },
  });
}

/** Reads the system prompt once while the greeting plays, so the caller's first question does not wait for a cold model. */
function warmUp(model: LlmAdapter, systemPrompt: string): void {
  if (env("ASKG1_WARMUP") === "off") return; // for measuring: does the head start help, or does it make the first question wait in line?
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  void (async () => {
    try { for await (const _ of model.chat({ messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Hello" }], signal: ac.signal })) break; } catch { /* only a head start */ }
    clearTimeout(timer);
  })();
}

/** Turns a voice choice into an engine. Cloned voices are checked against the database, so a withdrawn voice can never be used. */
async function engineFor(voice: string, user: VoiceTokenClaims, say: Say, language: "en" | "hi" | "en-hi" = "en", phone = false): Promise<TtsEngine> {
  if (voice.startsWith("pocket:")) {
    const name = voice.slice(7);
    if (!isBuiltInPocketVoice(name)) throw new Error("unknown built-in voice");
    // Built-in names: the male ones get a male Hindi voice, the rest a female one.
    const g: Gender = ["marius", "javert", "jean", "charles", "george", "paul", "michael"].includes(name) ? "male" : "female";
    return { ...(phone ? pocketMulawEngine : pocketPcmEngine)(pocket(say), name, kokoroHindiVoiceFor(g)), gender: g };
  }
  // "el:<ElevenLabs voice id>" or "el:<id>:male": a stock ElevenLabs voice, in English and Hindi, with no clone or database entry.
  if (voice.startsWith("el:")) {
    const [id, gender] = voice.slice(3).split(":");
    if (!id || !/^[A-Za-z0-9]{10,40}$/.test(id)) throw new Error("unknown ElevenLabs voice");
    const key = env("ELEVENLABS_API_KEY");
    if (!key) throw new Error("ELEVENLABS_API_KEY is not set");
    const g: Gender = gender === "male" ? "male" : "female";
    return { ...(phone ? mulawAdapterEngine(createElevenLabsTts({ apiKey: key }), id) : elevenLabsPcmEngine(key, id)), gender: g };
  }
  if (voice.startsWith("dg:")) {
    const id = voice.slice(3);
    const stock = stockVoiceById(id);
    if (!stock) throw new Error("unknown stock voice");
    const key = env("DEEPGRAM_API_KEY");
    if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
    return { ...(phone ? mulawAdapterEngine : mulawAdapterAsPcm)(createDeepgramTts({ apiKey: key }), id), gender: stock.gender === "male" ? "male" : "female" };
  }
  if (voice.startsWith("profile:")) {
    const profile = await resolveCallVoice(getDb(), user.org, { voiceProfileId: voice.slice(8) });
    if (profile.provider === "pocket_tts" && env("KOKORO_URL") && language !== "en") {
      const voicesDir = env("POCKET_TTS_VOICES_DIR") ?? join(REPO_DIR, ".local/voices");
      const own = !!env("VOICE_CONVERT_URL") && existsSync(join(voicesDir, `${profile.providerVoiceId}.se.pt`));
      say({ type: "notice", message: own
        ? `Hindi and Hinglish are changed into ${profile.label}'s own voice, which adds about a second per sentence. English uses the clone.`
        : `Hindi and Hinglish are spoken by a built-in ${profile.gender} Hindi voice, not ${profile.label}'s own voice. English uses the clone.` });
    }
    const g: Gender = profile.gender === "male" ? "male" : "female";
    // CHATTERBOX_URL set and this person has a reference recording: Hindi and mixed calls are made directly in their own voice (browser calls only).
    if (profile.provider === "pocket_tts" && env("CHATTERBOX_URL") && language !== "en" && !phone && (existsSync(join(env("POCKET_TTS_VOICES_DIR") ?? join(REPO_DIR, ".local/voices"), `${profile.providerVoiceId}.ref.wav`)) || !!(await getVoiceSampleForEngine(getDb(), user.org, profile.providerVoiceId)))) {
      say({ type: "notice", message: `${profile.label}'s Hindi is made directly in their own voice (Chatterbox).` });
      return { ...withProsody(chatterboxEngine(env("CHATTERBOX_URL")!, profile.providerVoiceId, { token: env("CHATTERBOX_TOKEN"), loadRecording: (id) => getVoiceSampleForEngine(getDb(), user.org, id), voicesDir: env("POCKET_TTS_VOICES_DIR") ?? join(REPO_DIR, ".local/voices") }), profile), gender: g };
    }
    if (profile.provider === "pocket_tts") return { ...withProsody((phone ? pocketMulawEngine : pocketPcmEngine)(pocket(say), profile.providerVoiceId, kokoroHindiVoiceFor(profile.gender)), profile), gender: g };
    if (profile.provider === "elevenlabs") {
      const apiKey = env("ELEVENLABS_API_KEY");
      if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
      return { ...(phone ? mulawAdapterEngine : mulawAdapterAsPcm)(createElevenLabsTts({ apiKey }), profile.providerVoiceId), gender: g };
    }
    throw new Error("unsupported voice provider");
  }
  throw new Error("unknown voice");
}

const start = z.object({
  type: z.literal("start"), language: z.enum(["en", "hi", "en-hi"]).default("en"), voice: z.string().min(1).max(120), greeting: z.boolean().default(true),
  listen: z.enum(["close", "anyone", "push"]).default("close"),
  /** Set when this is an outbound call to a lead: Do Not Disturb, consent and calling hours are checked before anything is spoken. */
  leadId: z.string().uuid().optional(),
});

const app = express();
app.get("/healthz", (_req, res) => res.json({ ok: true, sessions: connections }));
const server = createServer(app);
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME });
const sessions = new Set<Conversation>();
/** Connections accepted and not yet closed. Counted from the moment they are accepted, because a call takes a moment to set up
 * and a burst of simultaneous calls would otherwise all pass the limit before any of them is counted. */
let connections = 0;

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url ?? "/", "http://x");
  const refuse = (code: number, why: string) => { socket.write(`HTTP/1.1 ${code} ${why}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
  const isPhone = url.pathname === "/plivo/stream";
  if (url.pathname !== "/stream" && !isPhone) return refuse(404, "Not Found");
  // A browser must come from an allowed page. The phone carrier is not a browser: its audio stream is protected by the signed, short-lived token alone.
  if (!isPhone && !originAllowed(req.headers.origin, ORIGINS)) return refuse(403, "Forbidden");
  if (isPhone && !phoneReady()) return refuse(503, "Phone line not configured");
  const claims = TOKEN_KEY ? verifyVoiceToken(url.searchParams.get("token") ?? "", TOKEN_KEY) : null;
  if (!claims) return refuse(401, "Unauthorized");
  if (connections >= MAX_SESSIONS) return refuse(503, "Busy");
  connections++;
  socket.once("close", () => { connections--; }); // the socket, not the WebSocket: it also fires if the upgrade never completes
  wss.handleUpgrade(req, socket, head, (ws) => (isPhone ? handlePlivo(ws, claims, url.searchParams) : handle(ws, claims)));
});

/** Writes the finished call (log, transcript, and a hand-over audit entry) so it shows in the call logs. A call that fails to save is logged, never lost silently. */
async function saveCall(convo: Conversation, r: SessionRecord | null): Promise<void> {
  if (!r) return;
  const reason = convo.handoffReason();
  await saveAiCall(getDb(), r.user, {
    providerCallUuid: r.callId, direction: r.direction, source: r.direction === "outbound" ? "ai_outbound" : "ai_inbound",
    startedAt: r.startedAt, durationS: convo.durationMs() / 1000, segments: convo.transcript(), language: r.language,
    leadId: r.leadId, voiceProfileId: r.voiceProfileId, handoff: reason ? { reason } : undefined,
  });
}

interface SessionRecord { user: AuthUser; callId: string; startedAt: Date; language: string; direction: "inbound" | "outbound"; leadId?: string; voiceProfileId?: string }
interface StartParams { voice: string; language: "en" | "hi" | "en-hi"; greeting: boolean; listen: ListenMode; leadId?: string; opening?: string }

/** The call may not go ahead (not allowed, or on the Do Not Disturb list). `code` is the WebSocket close code, `event` what the client is told. */
class SessionRefused extends Error { constructor(public code: number, public event: ServerEvent) { super(event.type); } }

/**
 * Everything a call needs, the same for a browser and for a phone line: the voice, the organisation's own instruction and knowledge,
 * hand-over rules, Do Not Disturb / consent / calling-hours check for outbound calls, and the record that saves the call at the end.
 * `phone` selects 8 kHz µ-law output, which is what the carrier wants.
 */
async function buildSession(
  claims: VoiceTokenClaims, p: StartParams, io: { send: Say; sendAudio: (chunk: Uint8Array) => void },
  o: { phone: boolean; direction: "inbound" | "outbound"; callId?: string },
): Promise<{ convo: Conversation; record: SessionRecord | null }> {
  const tag = claims.sub.slice(0, 8);
  const voice = p.voice || claims.voice || "pocket:alba";
  const user = env("DATABASE_URL") ? await loadAuthUser(getDb(), claims.org, claims.sub).catch(() => null) : null;
  // Outbound: never place the call to a person who must not be called (SOP: DND, consent, 9am to 9pm India time).
  if (p.leadId) {
    if (!user?.permissions.includes("calls.place")) throw new SessionRefused(4004, { type: "error", message: "You are not allowed to place calls." });
    const check = await checkOutboundCall(getDb(), user, p.leadId);
    if (!check.allowed) {
      console.log(`[${tag}] outbound call blocked: ${check.reason}`);
      throw new SessionRefused(4005, { type: "blocked", reason: check.reason, message: CALL_BLOCK_MESSAGES[check.reason] });
    }
  }
  await findWebBase();
  const tts = await engineFor(voice, claims, io.send, p.language, o.phone);
  tts.cacheKey = `${voice}|${p.language}|${o.phone ? "phone" : "web"}${tts.variant ? `|${tts.variant}` : ""}`;
  if (env("ACK") !== "off") for (const w of p.language === "en" ? ["Sure.", "Let me check."] : p.language === "hi" ? ["जी।"] : ["Sure.", "Let me check.", "जी।"]) void primeAck(tts, w);
  // The organisation's own AI instruction and greeting (Settings), and its knowledge base, when this is a real signed-in user.
  let systemPrompt = systemPromptFor(p.language), greeting = GREETING, disclosure = "This call may be recorded.";
  let ground: ((text: string, previous?: string) => Promise<string[]>) | undefined;
  let handoff: ConstructorParameters<typeof Conversation>[0]["handoff"];
  let aiChoice: { model: "default" | "openrouter"; openrouterModel: string } | undefined;
  if (user?.permissions.includes("studio.use")) {
    const cfg = await getAgentConfig(getDb(), user);
    aiChoice = { model: cfg.model, openrouterModel: cfg.openrouterModel };
    systemPrompt = `${cfg.systemPrompt}\n\n${voiceRulesFor(p.language)}`;
    greeting = `${cfg.disclosure} ${cfg.greeting}`.trim();
    disclosure = cfg.disclosure; // an A/B opening line replaces the greeting but never the AI and recording notice
    handoff = { enabled: { person: true, complaint: cfg.handoffOnComplaint, payment: cfg.handoffOnPayment }, message: { en: cfg.handoffMessage, hi: HANDOFF_HINDI } };
    const lookup = async (text: string) => {
      // The knowledge base is English and matched by words, so a Hindi question is searched by its English keywords.
      const query = hindiToEnglishKeywords(text); // English words in the question, plus glossary words for Hindi and Hinglish
      if (query && query !== text.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, "").trim()) console.log(`[${tag}] searching the knowledge base for: ${query}`);
      if (!query) return [];
      return (await searchKnowledge(getDb(), user, query, 2)).map((r) => `${r.title}: ${relevantExcerpt(r.content, query)}`);
    };
    // A follow-up such as "and the other ones?" (or a garbled one) finds nothing by itself: search again with what they asked before.
    ground = async (text, previous) => {
      const found = await lookup(text);
      return found.length || !previous ? found : lookup(`${previous} ${text}`);
    };
  }
  if (tts.gender) systemPrompt += speakerNote(tts.gender);
  systemPrompt += sessionLanguageRule(p.language);
  const model = llm(io.send, aiChoice);
  warmUp(model, systemPrompt);
  const convo = new Conversation({
    holdUnfinishedMs: Number(env("TURN_HOLD_MS") ?? 0), // e.g. TURN_HOLD_MS=600 with ENDPOINTING_MS=250: wait for the rest when a sentence stops on "and", "my name is", "और"
    stt: sttFor(p.listen, p.language, (l) => console.log(`[${tag}] ${l}`)),
    llm: model, tts, language: p.language, systemPrompt, ground, ack: env("ACK") === "off" ? undefined : (t) => ackFor(t, p.language, true), turnNote: (a, b) => languageNote(a, b, p.language), handoff,
    greeting: p.greeting ? (p.opening ? `${disclosure} ${p.opening}`.trim() : p.language === "hi" ? GREETING_HI : p.language === "en-hi" ? GREETING_HINGLISH : greeting) : undefined,
    resumeAfterHandoff: !o.phone,
    fallback: p.language === "hi" ? FALLBACK_HI : FALLBACK, send: io.send, sendAudio: io.sendAudio, log: (l) => console.log(`[${tag}] ${l}`),
  });
  const record: SessionRecord | null = user?.permissions.includes("calls.place")
    ? { user, callId: o.callId ?? randomUUID(), startedAt: new Date(), language: p.language, direction: o.direction, leadId: p.leadId, voiceProfileId: voice.startsWith("profile:") ? voice.slice(8) : undefined }
    : null;
  return { convo, record };
}

/** A finished call: stop the conversation, then save it. A call that fails to save is logged, never lost silently. */
function endSession(convo: Conversation, record: SessionRecord | null, tag: string) {
  sessions.delete(convo);
  void convo.close().then(() => saveCall(convo, record)).catch((e) => console.error("could not save the call:", e instanceof Error ? e.message : e));
  console.log(`[${tag}] session ended; ${sessions.size} active`);
}

/** A browser (Live page, Agent console). */
function handle(ws: WebSocket, claims: VoiceTokenClaims) {
  let convo: Conversation | null = null;
  let record: SessionRecord | null = null;
  const send = (e: ServerEvent) => { if (ws.readyState === 1) ws.send(JSON.stringify(e)); };
  const startTimer = setTimeout(() => ws.close(4000, "no start message"), 5000);
  const limit = setTimeout(() => ws.close(4001, "call time limit"), MAX_CALL_MS);

  ws.on("message", async (data: RawData, isBinary: boolean) => {
    if (isBinary) { if (convo) convo.pushAudio(data as Buffer); return; }
    let msg: unknown;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if ((msg as { type?: string })?.type === "stop") return void ws.close(1000);
    if (convo) return;
    const parsed = start.safeParse(msg);
    if (!parsed.success) { send({ type: "error", message: "invalid start message" }); return void ws.close(4002, "bad start"); }
    clearTimeout(startTimer);
    try {
      const built = await buildSession(claims, parsed.data, { send, sendAudio: (chunk) => { if (ws.readyState === 1) ws.send(chunk); } }, { phone: false, direction: parsed.data.leadId ? "outbound" : "inbound" });
      convo = built.convo; record = built.record;
      sessions.add(convo);
      await convo.start();
      console.log(`[${claims.sub.slice(0, 8)}] session started (${parsed.data.voice || claims.voice}, ${parsed.data.language}, listening: ${parsed.data.listen}); ${sessions.size} active`);
    } catch (e) {
      if (e instanceof SessionRefused) { send(e.event); return void ws.close(e.code, e.event.type); }
      send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      ws.close(4003, "could not start");
    }
  });
  ws.on("close", () => {
    clearTimeout(startTimer); clearTimeout(limit);
    if (convo) endSession(convo, record, claims.sub.slice(0, 8));
  });
  ws.on("error", () => ws.close());
}

// ------------------------------------------------------------------------------------------------ the phone line (Plivo)

const PLIVO_ID = env("PLIVO_AUTH_ID"), PLIVO_TOKEN = env("PLIVO_AUTH_TOKEN");
/** The public https address Plivo reaches this service at (a tunnel in development). Plivo signs requests with the exact address it called. */
const PUBLIC_URL = env("PUBLIC_BASE_URL")?.replace(/\/$/, "");
const plivo = PLIVO_ID && PLIVO_TOKEN ? createPlivo({ authId: PLIVO_ID, authToken: PLIVO_TOKEN, baseUrl: env("PLIVO_API_BASE") }) : null;
const phoneReady = () => !!(plivo && PUBLIC_URL && TOKEN_KEY);
const callLanguage = z.enum(["en", "hi", "en-hi"]);

app.use("/plivo", express.urlencoded({ extended: false, limit: "64kb" }));

/** Only Plivo may call these: the request must carry a valid signature for the exact public address and form fields. */
function fromPlivo(req: express.Request): boolean {
  if (!PLIVO_TOKEN || !PUBLIC_URL) return false;
  return verifyPlivoSignature({
    url: `${PUBLIC_URL}${req.originalUrl}`, params: (req.body ?? {}) as Record<string, string>, nonce: req.header("x-plivo-signature-v3-nonce"),
    header: req.header("x-plivo-signature-v3"), authToken: PLIVO_TOKEN,
  });
}

/**
 * Plivo asks what to do when a call is answered (a call to our number, or one we placed). We answer with an instruction to open a
 * two-way audio stream to this service. Who is calling as is decided here and carried in a short-lived signed token.
 */
/** Opens the two-way audio stream to the AI for this call. Used straight from "answer", or after the caller chose "assistant" in the menu. */
function connectToAi(claims: VoiceTokenClaims, o: { lang?: string; lead?: string; callUuid?: string; from?: string; op?: string }) {
  const params = new URLSearchParams({
    token: signVoiceToken({ sub: claims.sub, org: claims.org, voice: claims.voice }, TOKEN_KEY!, 120),
    language: o.lang ?? callLanguage.catch("en-hi").parse(env("PLIVO_LANGUAGE")), call: o.callUuid ?? "", from: o.from ?? "",
    ...(o.lead ? { lead: o.lead } : {}), ...(o.op ? { op: o.op } : {}), direction: o.lead ? "outbound" : "inbound",
  });
  return plivoStreamXml(`${PUBLIC_URL!.replace(/^http/, "ws")}/plivo/stream?${params}`);
}

const menuQuery = z.object({ t: z.string().optional(), lead: z.string().uuid().optional(), lang: callLanguage.optional(), op: z.string().max(300).optional() });
/** The identity a call runs as: a call we placed carries its own signed token; a call to our number runs as the configured service user. */
const claimsFor = (t?: string): VoiceTokenClaims | null => t ? verifyVoiceToken(t, TOKEN_KEY!) : env("PLIVO_ORG_ID") && env("PLIVO_AGENT_USER_ID")
  ? { sub: env("PLIVO_AGENT_USER_ID")!, org: env("PLIVO_ORG_ID")!, voice: env("PLIVO_VOICE") } : null;

/**
 * Plivo asks what to do when a call is answered (a call to our number, or one we placed). We answer with an instruction to open a
 * two-way audio stream to this service, or, when the organisation turned on its touch-tone menu, with the menu first.
 * Who is calling is decided here and carried in a short-lived signed token.
 */
app.post("/plivo/answer", async (req, res) => {
  if (!phoneReady()) return void res.status(503).type("text/plain").send("phone line not configured");
  if (!fromPlivo(req)) return void res.status(403).type("text/plain").send("bad signature");
  const body = req.body as Record<string, string>;
  const q = menuQuery.safeParse(req.query);
  if (!q.success) return void res.status(400).type("text/plain").send("bad request");
  const claims = claimsFor(q.data.t);
  if (!claims) return void res.type("text/xml").send(plivoHangupXml());
  const lang = q.data.lang ?? callLanguage.catch("en-hi").parse(env("PLIVO_LANGUAGE"));
  const ai = { lang: q.data.lang, lead: q.data.lead, callUuid: body.CallUUID, from: body.From, op: q.data.op };
  try {
    const cfg = await getPhoneConfig(getDb(), claims.org);
    if (cfg.menu.enabled && Object.keys(cfg.menu.options).length > 0) {
      const pass = new URLSearchParams({ ...(q.data.t ? { t: q.data.t } : {}), ...(q.data.lead ? { lead: q.data.lead } : {}), ...(q.data.lang ? { lang: q.data.lang } : {}), ...(q.data.op ? { op: q.data.op } : {}) });
      const audioT = signVoiceToken({ sub: claims.sub, org: claims.org, voice: claims.voice }, TOKEN_KEY!, 900);
      return void res.type("text/xml").send(plivoMenuXml({
        audioUrl: `${PUBLIC_URL}/plivo/menu-audio?${new URLSearchParams({ t: audioT, lang })}`,
        actionUrl: `${PUBLIC_URL}/plivo/menu?${pass}`, fallbackUrl: `${PUBLIC_URL}/plivo/menu?${pass}`, validDigits: Object.keys(cfg.menu.options).join(""),
      }));
    }
  } catch (e) { console.error("menu settings could not be read, connecting straight to the AI:", e instanceof Error ? e.message : e); }
  res.type("text/xml").send(connectToAi(claims, ai));
});

/** The caller pressed a key (or nothing). The key decides: the assistant, a person, or hang up. Anything else goes to the assistant. */
app.post("/plivo/menu", async (req, res) => {
  if (!phoneReady()) return void res.status(503).type("text/plain").send("phone line not configured");
  if (!fromPlivo(req)) return void res.status(403).type("text/plain").send("bad signature");
  const body = req.body as Record<string, string>;
  const q = menuQuery.safeParse(req.query);
  const claims = q.success ? claimsFor(q.data.t) : null;
  if (!q.success || !claims) return void res.type("text/xml").send(plivoHangupXml());
  const cfg = await getPhoneConfig(getDb(), claims.org).catch(() => null);
  const choice = cfg?.menu.options[(body.Digits ?? "").trim()] ?? "ai";
  console.log(`[phone menu] key "${(body.Digits ?? "").trim() || "none"}" -> ${choice}`);
  if (choice === "hangup") return void res.type("text/xml").send(plivoHangupXml());
  if (choice === "person") {
    const to = cfg?.handoffNumber || env("PLIVO_HANDOFF_NUMBER");
    if (to) return void res.type("text/xml").send(plivoDialXml(to));
  }
  res.type("text/xml").send(connectToAi(claims, { lang: q.data.lang, lead: q.data.lead, callUuid: body.CallUUID, from: body.From, op: q.data.op }));
});

/** The menu prompt as an audio file, spoken by our own voice (never a cloud voice). Cached; the address carries a short-lived signed token. */
const menuAudio = new Map<string, Buffer>();
app.get("/plivo/menu-audio", async (req, res) => {
  const claims = verifyVoiceToken(String(req.query.t ?? ""), TOKEN_KEY!);
  const lang = callLanguage.safeParse(req.query.lang);
  if (!claims || !lang.success) return void res.status(403).type("text/plain").send("forbidden");
  try {
    const cfg = await getPhoneConfig(getDb(), claims.org);
    const text = lang.data === "en" ? cfg.menu.prompt : cfg.menu.promptHi || cfg.menu.prompt;
    const voice = claims.voice || env("PLIVO_VOICE") || "pocket:alba";
    const key = `${claims.org}|${voice}|${lang.data}|${text}`;
    let wav = menuAudio.get(key);
    if (!wav) {
      const tts = await engineFor(voice, claims, () => {}, lang.data, true);
      const parts: Uint8Array[] = [];
      for await (const c of tts.speak(text, AbortSignal.timeout(30_000))) parts.push(c);
      const bytes = Buffer.concat(parts);
      const pcm = tts.encoding === "mulaw" ? mulawToPcm16(bytes) : new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + (bytes.length & ~1)));
      const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength), h = Buffer.alloc(44), rate = tts.rate;
      h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
      h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
      wav = Buffer.concat([h, data]);
      if (menuAudio.size > 50) menuAudio.clear();
      menuAudio.set(key, wav);
    }
    res.type("audio/wav").send(wav);
  } catch (e) {
    console.error("menu prompt could not be made:", e instanceof Error ? e.message : e);
    res.status(502).type("text/plain").send("could not make the prompt");
  }
});

/**
 * A text that came in (Plivo's "message URL" for the number). Filed under the person; STOP switches Do Not Disturb on.
 * Note: Plivo does not support receiving SMS on Indian numbers, so this works for numbers in other countries.
 */
app.post("/plivo/sms", async (req, res) => {
  if (!fromPlivo(req)) return void res.status(403).type("text/plain").send("bad signature");
  const body = req.body as Record<string, string>;
  const org = env("PLIVO_ORG_ID");
  const from = (body.From ?? "").replace(/[^\d+]/g, "");
  if (!org || !/^\+?\d{8,15}$/.test(from)) return void res.status(204).end();
  const text = String(body.Text ?? "");
  let leadId = "";
  try { leadId = await recordInboundSms(getDb(), org, from.startsWith("+") ? from : `+${from}`, text); } catch (e) { console.error("incoming text could not be saved:", e instanceof Error ? e.message : e); }
  res.status(204).end();
  if (leadId && !/^(stop|unsubscribe|cancel|end|quit|band|बंद)$/i.test(text.trim())) void autoReplyToText(org, leadId, text);
});

/**
 * With "answer incoming texts automatically" on (Settings), the AI answers from the knowledge base. The answer is queued like any other
 * text, so the calling hours, Do Not Disturb, KYC and credit rules all still apply. At most one automatic reply per person per 10 minutes.
 */
async function autoReplyToText(orgId: string, leadId: string, incoming: string) {
  try {
    const agentId = env("PLIVO_AGENT_USER_ID");
    if (!agentId) return;
    const user = await loadAuthUser(getDb(), orgId, agentId);
    if (!user?.permissions.includes("studio.use")) return;
    const cfg = await getAgentConfig(getDb(), user);
    const settings = await getPhoneConfigSms(orgId);
    if (!settings || (await sentTextRecently(getDb(), user, leadId, 10))) return;
    const query = hindiToEnglishKeywords(incoming);
    const found = query ? (await searchKnowledge(getDb(), user, query, 2)).map((r) => `${r.title}: ${relevantExcerpt(r.content, query)}`) : [];
    const system = `${cfg.systemPrompt}\n\nYou are replying to a TEXT MESSAGE. Reply in the same language and script as the sender, in at most 300 characters, plain text only, no markdown. Use only the facts below; if they do not cover the question, say a colleague will get back to them.\n\nFacts:\n${found.join("\n") || "(none)"}`;
    let reply = "";
    for await (const t of llm(undefined, { model: cfg.model, openrouterModel: cfg.openrouterModel }).chat({ messages: [{ role: "system", content: system }, { role: "user", content: incoming.slice(0, 600) }], signal: AbortSignal.timeout(20_000) })) { reply += t; if (reply.length > 600) break; }
    reply = reply.replace(/\s+/g, " ").trim().slice(0, 320);
    if (reply) await queueSmsToLead(getDb(), user, { leadId, body: reply });
  } catch (e) { console.error("automatic text reply failed:", e instanceof Error ? e.message : e); }
}
const getPhoneConfigSms = async (orgId: string) => (await getSmsSettings(getDb(), orgId))?.autoReply ? true : null;

/** Plivo asks where to send a call we are handing to a person. */
app.post("/plivo/transfer", async (req, res) => {
  if (!fromPlivo(req)) return void res.status(403).type("text/plain").send("bad signature");
  // The organisation's own number (Settings), else the one set on the server. The address is signed by Plivo, so the org in it can be trusted.
  const org = z.string().uuid().safeParse(req.query.org);
  const own = org.success ? (await getPhoneConfig(getDb(), org.data).catch(() => null))?.handoffNumber : "";
  const to = own || env("PLIVO_HANDOFF_NUMBER");
  res.type("text/xml").send(to ? plivoDialXml(to) : plivoHangupXml());
});

/** Plivo reports whether an answering machine picked up (Machine=true). A machine gets no AI conversation: hang up, and the campaign tries again later. */
app.post("/plivo/machine", async (req, res) => {
  if (!fromPlivo(req)) return void res.status(403).type("text/plain").send("bad signature");
  const body = req.body as Record<string, string>;
  const lead = z.string().uuid().safeParse(req.query.lead);
  res.status(204).end();
  if (String(body.Machine).toLowerCase() !== "true" || !lead.success) return;
  console.log(`[phone] answering machine on call ${body.CallUUID ?? "?"}: hanging up`);
  try {
    if (body.CallUUID && plivo) await plivo.hangup(body.CallUUID);
    await reportMachine(getDb(), lead.data);
  } catch (e) { console.error("answering machine hang-up failed:", e instanceof Error ? e.message : e); }
});

/**
 * Places an AI call to a lead. The caller proves who they are with a signed voice token (the website makes one); the same Do Not Disturb,
 * consent and calling-hours check as everywhere else runs BEFORE the phone is dialled.
 */
app.post("/plivo/outbound", express.json({ limit: "4kb" }), async (req, res) => {
  if (!phoneReady() || !env("PLIVO_NUMBER")) return void res.status(503).json({ error: "phone_not_configured" });
  const claims = verifyVoiceToken(/^Bearer (\S+)$/.exec(req.header("authorization") ?? "")?.[1] ?? "", TOKEN_KEY!);
  const b = z.object({ leadId: z.string().uuid(), language: callLanguage.default("en-hi"), opening: z.string().trim().max(300).optional(), detectMachines: z.boolean().optional() }).safeParse(req.body);
  if (!claims || !b.success) return void res.status(claims ? 400 : 401).json({ error: claims ? "invalid_request" : "unauthenticated" });
  try {
    const user = await loadAuthUser(getDb(), claims.org, claims.sub);
    if (!user?.permissions.includes("calls.place")) return void res.status(403).json({ error: "forbidden" });
    const check = await checkOutboundCall(getDb(), user, b.data.leadId);
    if (!check.allowed) return void res.status(409).json({ error: "blocked", reason: check.reason, message: CALL_BLOCK_MESSAGES[check.reason] });
    const to = await getLeadPhone(getDb(), user, b.data.leadId);
    if (!to) return void res.status(404).json({ error: "unknown_lead" });
    const t = signVoiceToken({ sub: claims.sub, org: claims.org, voice: claims.voice }, TOKEN_KEY!, 600); // 10 minutes to ring and be answered
    const { callUuid } = await plivo!.makeCall({ from: env("PLIVO_NUMBER")!, to, answerUrl: `${PUBLIC_URL}/plivo/answer?${new URLSearchParams({ t, lead: b.data.leadId, lang: b.data.language, ...(b.data.opening ? { op: b.data.opening } : {}) })}`,
      ...(b.data.detectMachines ? { machineUrl: `${PUBLIC_URL}/plivo/machine?${new URLSearchParams({ lead: b.data.leadId })}` } : {}),
    });
    res.status(202).json({ callUuid });
  } catch (e) {
    console.error("outbound call failed:", e instanceof Error ? e.message : e);
    res.status(502).json({ error: "carrier_error" });
  }
});

/** The audio of one phone call. */
function handlePlivo(ws: WebSocket, claims: VoiceTokenClaims, q: URLSearchParams) {
  const tag = `phone ${claims.sub.slice(0, 6)}`;
  let convo: Conversation | null = null, record: SessionRecord | null = null;
  let streamId = "", callUuid = q.get("call") ?? "", started = false, transferring = false;
  const upsample = new MulawTo16k();
  const sendWs = (m: string) => { if (ws.readyState === 1) ws.send(m); };
  const limit = setTimeout(() => ws.close(4001, "call time limit"), MAX_CALL_MS);

  /** Said the hand-over line, then wait for it to finish playing before the call is moved to a person. */
  let waitingToTransfer = false, transferTimer: ReturnType<typeof setTimeout> | undefined;
  const transfer = () => {
    if (transferring || !plivo || !callUuid || !PUBLIC_URL) return;
    transferring = true;
    plivo.transferCall({ callUuid, legUrl: `${PUBLIC_URL}/plivo/transfer?org=${claims.org}` }).then(() => console.log(`[${tag}] call handed to a person`), (e) => console.error(`[${tag}] hand-over failed:`, e instanceof Error ? e.message : e));
  };
  const onEvent = (e: ServerEvent) => {
    if (e.type === "clear" && streamId) sendWs(plivoClearAudio(streamId));            // the caller interrupted: drop what is queued
    else if (e.type === "handoff") { waitingToTransfer = true; transferTimer = setTimeout(transfer, 12_000); } // at most 12 s for the line to be said
    else if (e.type === "state" && e.state === "listening" && waitingToTransfer) { clearTimeout(transferTimer); setTimeout(transfer, 500); }
    else if (e.type === "error") console.log(`[${tag}] error: ${e.message}`);
  };

  ws.on("message", async (data: RawData) => {
    const m = parsePlivoStreamMessage(data.toString());
    if (!m) return;
    if (m.type === "media") { convo?.pushAudio(upsample.convert(m.audio)); return; }
    if (m.type === "stop") return void ws.close(1000);
    if (m.type !== "start" || started) return;
    started = true; streamId = m.streamId; callUuid = m.callId || callUuid;
    const lead = q.get("lead") ?? undefined, from = normalizePhone(q.get("from") ?? "");
    try {
      const user = env("DATABASE_URL") ? await loadAuthUser(getDb(), claims.org, claims.sub).catch(() => null) : null;
      // An incoming call is filed under the lead with the caller's number, when there is one.
      const leadId = lead ?? (user && from ? await findLeadIdByPhone(getDb(), user, from).catch(() => null) ?? undefined : undefined);
      const built = await buildSession(claims, { voice: claims.voice ?? "pocket:alba", language: callLanguage.catch("en-hi").parse(q.get("language")), greeting: true, listen: "anyone", leadId: lead, opening: q.get("op")?.slice(0, 300) || undefined },
        { send: onEvent, sendAudio: (chunk) => sendWs(plivoPlayAudio(chunk)) }, { phone: true, direction: q.get("direction") === "outbound" ? "outbound" : "inbound", callId: callUuid || undefined });
      convo = built.convo; record = built.record && leadId ? { ...built.record, leadId } : built.record;
      sessions.add(convo);
      await convo.start();
      console.log(`[${tag}] call started (${q.get("direction")}); ${sessions.size} active`);
    } catch (e) {
      console.log(`[${tag}] call not started: ${e instanceof SessionRefused ? e.event.type : e instanceof Error ? e.message : e}`);
      ws.close(e instanceof SessionRefused ? e.code : 4003, "could not start");
    }
  });
  ws.on("close", () => {
    clearTimeout(limit); clearTimeout(transferTimer);
    if (convo) endSession(convo, record, tag);
  });
  ws.on("error", () => ws.close());
}

if (!TOKEN_KEY) console.warn("VOICE_TOKEN_SECRET (or SESSION_SECRET) is not set: every stream will be refused.");
/**
 * AskG1 keeps a saved copy of the start of the instruction it last read, and a request with an instruction it has not read
 * recently waits 6 to 13 seconds. So at start-up and every few minutes this sends a one-word request with the standard
 * instruction (for a woman's and a man's voice), and the first caller after a quiet spell does not pay for it.
 * ASKG1_KEEPWARM=off turns it off. Organisations with their own instruction are not covered.
 */
function keepWarm(): void {
  const apiKey = env("ASKG1_API_KEY"), baseUrl = env("ASKG1_BASE_URL");
  if (!apiKey || !baseUrl || env("ASKG1_KEEPWARM") === "off") return;
  const main = createAskG1({ apiKey, baseUrl, model: env("ASKG1_MODEL"), maxTokens: 1, responseTimeoutMs: 40_000 });
  const ping = async () => {
    for (const [language, gender] of [["en", "female"], ["en", "male"], ["hi", "female"], ["hi", "male"], ["en-hi", "female"], ["en-hi", "male"]] as const) {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 40_000);
      try { for await (const _ of main.chat({ messages: [{ role: "system", content: systemPromptFor(language) + speakerNote(gender) + sessionLanguageRule(language) }, { role: "user", content: "Hello" }], signal: ac.signal })) break; } catch { /* only a head start */ }
      clearTimeout(timer);
    }
  };
  void ping();
  setInterval(() => void ping(), 4 * 60_000).unref();
}

server.listen(PORT, () => { console.log(`voice service listening on :${PORT}`); keepWarm(); });
