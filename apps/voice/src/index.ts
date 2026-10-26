import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { z } from "zod";
import { verifyVoiceToken, type AuthUser, type VoiceTokenClaims } from "@voiceai/auth";
import { CALL_BLOCK_MESSAGES } from "@voiceai/shared";
import { checkOutboundCall, createDb, getAgentConfig, loadAuthUser, saveAiCall, resolveCallVoice, searchKnowledge, type Db } from "@voiceai/db";
import {
  createAskG1, createDeepgramLive, createDeepgramTts, createElevenLabsTts, createLocalWhisper, createPocketTts, isBuiltInPocketVoice, signVoiceFileId,
  kokoroHindiVoiceFor, stockVoiceById, voiceFileStem, type LlmAdapter, type PocketLanguage, type SttAdapter,
} from "@voiceai/providers";
import { mulawAdapterAsPcm, pocketPcmEngine } from "./engines";
import { hindiToEnglishKeywords, relevantExcerpt } from "./knowledge";
import { languageNote } from "./language";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { allowedOrigins, originAllowed } from "./origins";
import { HANDOFF_HINDI } from "./handoff";
import { withFailover } from "./llm-failover";
import { Conversation, type ServerEvent, type TtsEngine } from "./pipeline";
import { FALLBACK, GREETING, GREETING_HI, GREETING_HINGLISH, SYSTEM_PROMPT, VOICE_RULES } from "./prompt";

try { process.loadEnvFile(".env.local"); } catch { /* keys can also come from the real environment */ }
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

/** Local Whisper when it is set up (free, on this machine); otherwise Deepgram's cloud. */
function sttFor(listen: ListenMode, log?: (line: string) => void): SttAdapter {
  const whisper = env("WHISPER_URL");
  if (env("STT_PROVIDER") !== "deepgram" && whisper) {
    const endSilenceMs = Number(env("ENDPOINTING_MS") ?? 400);
    return createLocalWhisper({
      baseUrl: whisper,
      // A higher bar and a longer onset in "close" mode, so a nearby conversation does not start the AI talking or stop it.
      vad: listen === "close" ? { endSilenceMs, floor: 0.02, startMs: 160 } : { endSilenceMs },
      closeMic: listen === "close" ? {} : undefined,
      minConfidence: listen === "close" ? {} : undefined, // only consulted for quieter-than-usual speech, so normal answers stay fast
      onTranscribed: (i) => { log?.(i.dropped ? `ignored (${i.dropped})${i.avgLogprob !== undefined ? `, confidence ${i.avgLogprob.toFixed(2)}` : ""}` : `transcribed ${i.speechMs} ms of speech in ${i.ms} ms`); },
    });
  }
  const key = env("DEEPGRAM_API_KEY");
  if (!key) throw new Error("No speech-to-text is configured (set WHISPER_URL, or DEEPGRAM_API_KEY)");
  return createDeepgramLive({ apiKey: key, endpointingMs: Number(env("ENDPOINTING_MS") ?? 300) });
}

/**
 * AskG1 is the main model. LOCAL_LLM_URL (a llama.cpp server running Llama 3.2) is the backup: when AskG1 cannot be reached
 * or is too slow to start answering, the backup answers instead and the page is told, so nobody mistakes it for AskG1.
 */
function llm(say?: Say): LlmAdapter {
  const apiKey = env("ASKG1_API_KEY"), baseUrl = env("ASKG1_BASE_URL"), localUrl = env("LOCAL_LLM_URL");
  const maxTokens = Number(env("ASKG1_MAX_TOKENS") ?? 160), temperature = Number(env("ASKG1_TEMPERATURE") ?? 0.3);
  const local = localUrl ? createAskG1({ apiKey: "local", baseUrl: localUrl, model: "local", maxTokens, temperature }) : null;
  if (!apiKey || !baseUrl) {
    if (!local) throw new Error("AskG1 is not configured (ASKG1_API_KEY, ASKG1_BASE_URL)");
    say?.({ type: "notice", message: "AskG1 is not configured, so a small local model (Llama 3.2) is answering. It is less accurate than AskG1, especially in Hindi." });
    return local;
  }
  const askg1 = createAskG1({ apiKey, baseUrl, model: env("ASKG1_MODEL"), maxTokens, temperature });
  if (!local) return askg1;
  let told = false;
  return withFailover(askg1, local, {
    firstTokenTimeoutMs: Number(env("ASKG1_FIRST_TOKEN_TIMEOUT_MS") ?? 8000),
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
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  void (async () => {
    try { for await (const _ of model.chat({ messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "Hello" }], signal: ac.signal })) break; } catch { /* only a head start */ }
    clearTimeout(timer);
  })();
}

/** Turns a voice choice into an engine. Cloned voices are checked against the database, so a withdrawn voice can never be used. */
async function engineFor(voice: string, user: VoiceTokenClaims, say: Say, language: "en" | "hi" | "en-hi" = "en"): Promise<TtsEngine> {
  if (voice.startsWith("pocket:")) {
    const name = voice.slice(7);
    if (!isBuiltInPocketVoice(name)) throw new Error("unknown built-in voice");
    // Built-in names: the male ones get a male Hindi voice, the rest a female one.
    return pocketPcmEngine(pocket(say), name, kokoroHindiVoiceFor(["marius", "javert", "jean", "charles", "george", "paul", "michael"].includes(name) ? "male" : "female"));
  }
  if (voice.startsWith("dg:")) {
    const id = voice.slice(3);
    if (!stockVoiceById(id)) throw new Error("unknown stock voice");
    const key = env("DEEPGRAM_API_KEY");
    if (!key) throw new Error("DEEPGRAM_API_KEY is not set");
    return mulawAdapterAsPcm(createDeepgramTts({ apiKey: key }), id);
  }
  if (voice.startsWith("profile:")) {
    const profile = await resolveCallVoice(getDb(), user.org, { voiceProfileId: voice.slice(8) });
    if (profile.provider === "pocket_tts" && env("KOKORO_URL") && language !== "en") {
      const voicesDir = env("POCKET_TTS_VOICES_DIR") ?? join(process.cwd(), "../../.local/voices");
      const own = !!env("VOICE_CONVERT_URL") && existsSync(join(voicesDir, `${profile.providerVoiceId}.se.pt`));
      say({ type: "notice", message: own
        ? `Hindi and Hinglish are changed into ${profile.label}'s own voice, which adds about a second per sentence. English uses the clone.`
        : `Hindi and Hinglish are spoken by a built-in ${profile.gender} Hindi voice, not ${profile.label}'s own voice. English uses the clone.` });
    }
    if (profile.provider === "pocket_tts") return pocketPcmEngine(pocket(say), profile.providerVoiceId, kokoroHindiVoiceFor(profile.gender));
    if (profile.provider === "elevenlabs") {
      const apiKey = env("ELEVENLABS_API_KEY");
      if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
      return mulawAdapterAsPcm(createElevenLabsTts({ apiKey }), profile.providerVoiceId);
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
  if (url.pathname !== "/stream") return refuse(404, "Not Found");
  if (!originAllowed(req.headers.origin, ORIGINS)) return refuse(403, "Forbidden");
  const claims = TOKEN_KEY ? verifyVoiceToken(url.searchParams.get("token") ?? "", TOKEN_KEY) : null;
  if (!claims) return refuse(401, "Unauthorized");
  if (connections >= MAX_SESSIONS) return refuse(503, "Busy");
  connections++;
  socket.once("close", () => { connections--; }); // the socket, not the WebSocket: it also fires if the upgrade never completes
  wss.handleUpgrade(req, socket, head, (ws) => handle(ws, claims));
});

/** Writes the finished call (log, transcript, and a hand-over audit entry) so it shows in the call logs. A call that fails to save is logged, never lost silently. */
async function saveCall(convo: Conversation, r: { user: AuthUser; callId: string; startedAt: Date; language: string; leadId?: string; voiceProfileId?: string } | null): Promise<void> {
  if (!r) return;
  const reason = convo.handoffReason();
  await saveAiCall(getDb(), r.user, {
    providerCallUuid: r.callId, direction: r.leadId ? "outbound" : "inbound", source: r.leadId ? "ai_outbound" : "ai_inbound",
    startedAt: r.startedAt, durationS: convo.durationMs() / 1000, segments: convo.transcript(), language: r.language,
    leadId: r.leadId, voiceProfileId: r.voiceProfileId, handoff: reason ? { reason } : undefined,
  });
}

function handle(ws: WebSocket, claims: VoiceTokenClaims) {
  let convo: Conversation | null = null;
  let record: { user: AuthUser; callId: string; startedAt: Date; language: string; leadId?: string; voiceProfileId?: string } | null = null;
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
      const voice = parsed.data.voice || claims.voice || "pocket:alba";
      const user = env("DATABASE_URL") ? await loadAuthUser(getDb(), claims.org, claims.sub).catch(() => null) : null;
      // Outbound: never place the call to a person who must not be called (SOP: DND, consent, 9am to 9pm India time).
      if (parsed.data.leadId) {
        if (!user?.permissions.includes("calls.place")) { send({ type: "error", message: "You are not allowed to place calls." }); return void ws.close(4004, "forbidden"); }
        const check = await checkOutboundCall(getDb(), user, parsed.data.leadId);
        if (!check.allowed) {
          send({ type: "blocked", reason: check.reason, message: CALL_BLOCK_MESSAGES[check.reason] });
          console.log(`[${claims.sub.slice(0, 8)}] outbound call blocked: ${check.reason}`);
          return void ws.close(4005, "blocked");
        }
      }
      await findWebBase();
      const tts = await engineFor(voice, claims, send, parsed.data.language);
      // The organisation's own AI instruction and greeting (Settings), and its knowledge base, when this is a real signed-in user.
      let systemPrompt = SYSTEM_PROMPT, greeting = GREETING;
      let ground: ((text: string) => Promise<string[]>) | undefined;
      let handoff: ConstructorParameters<typeof Conversation>[0]["handoff"];
      if (user?.permissions.includes("studio.use")) {
        const cfg = await getAgentConfig(getDb(), user);
        systemPrompt = `${cfg.systemPrompt}\n\n${VOICE_RULES}`;
        greeting = `${cfg.disclosure} ${cfg.greeting}`.trim();
        handoff = { enabled: { person: true, complaint: cfg.handoffOnComplaint, payment: cfg.handoffOnPayment }, message: { en: cfg.handoffMessage, hi: HANDOFF_HINDI } };
        ground = async (text) => {
          // The knowledge base is English and matched by words, so a Hindi question is searched by its English keywords.
          const query = hindiToEnglishKeywords(text); // English words in the question, plus glossary words for Hindi and Hinglish
          if (query && query !== text.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, "").trim()) console.log(`[${claims.sub.slice(0, 8)}] searching the knowledge base for: ${query}`);
          if (!query) return [];
          return (await searchKnowledge(getDb(), user, query, 2)).map((r) => `${r.title}: ${relevantExcerpt(r.content, query)}`);
        };
      }
      const model = llm(send);
      warmUp(model, systemPrompt);
      convo = new Conversation({
        stt: sttFor(parsed.data.listen, (l) => console.log(`[${claims.sub.slice(0, 8)}] ${l}`)),
        llm: model, tts, language: parsed.data.language, systemPrompt, ground, turnNote: languageNote, handoff,
        greeting: parsed.data.greeting ? (parsed.data.language === "hi" ? GREETING_HI : parsed.data.language === "en-hi" ? GREETING_HINGLISH : greeting) : undefined,
        fallback: FALLBACK, send,
        sendAudio: (chunk) => { if (ws.readyState === 1) ws.send(chunk); },
        log: (l) => console.log(`[${claims.sub.slice(0, 8)}] ${l}`),
      });
      sessions.add(convo);
      if (user?.permissions.includes("calls.place")) {
        record = { user, callId: randomUUID(), startedAt: new Date(), language: parsed.data.language, leadId: parsed.data.leadId, voiceProfileId: voice.startsWith("profile:") ? voice.slice(8) : undefined };
      }
      await convo.start();
      console.log(`[${claims.sub.slice(0, 8)}] session started (${voice}, ${parsed.data.language}, listening: ${parsed.data.listen}); ${sessions.size} active`);
    } catch (e) {
      send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      ws.close(4003, "could not start");
    }
  });
  ws.on("close", () => {
    clearTimeout(startTimer); clearTimeout(limit);
    if (convo) {
      const ended = convo, saving = record;
      sessions.delete(ended);
      void ended.close().then(() => saveCall(ended, saving)).catch((e) => console.error("could not save the call:", e instanceof Error ? e.message : e));
      console.log(`[${claims.sub.slice(0, 8)}] session ended; ${sessions.size} active`);
    }
  });
  ws.on("error", () => ws.close());
}

if (!TOKEN_KEY) console.warn("VOICE_TOKEN_SECRET (or SESSION_SECRET) is not set: every stream will be refused.");
server.listen(PORT, () => console.log(`voice service listening on :${PORT}`));
