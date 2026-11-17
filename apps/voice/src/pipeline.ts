import type { ChatMessage, LlmAdapter, SttAdapter, SttEvent, SttSession } from "@voiceai/providers";
import { SentenceChunker } from "./sentences";
import { knowledgeBlock } from "./prompt";
import { normalizeBizfyPlanQuestion, unknownPlanReply } from "./knowledge";
import { forVoice } from "./speech-text";
import { looksUnfinished } from "./turn-end";
import { isSmallTalk } from "./ack";
import { dropFiller } from "./filler";
import { askAgainSlow, greetingFix, sorryAgain, stillWorking, strictNote, wrongLanguage } from "./language";
import { matchGender, type Gender } from "./gender";
import { detectHandoff, HANDOFF_ENGLISH, HANDOFF_HINDI, commitsToConnect, isAgreement, offeredHandoff, type HandoffEnabled, type HandoffReason } from "./handoff";
import { replyToGreeting, replyToIdentityQuestion, replyToOrphanedPlanFragment } from "./small-talk";
import type { TranscriptSegment } from "@voiceai/shared";

/** Speaks text as audio chunks in the engine's native format. Abort the signal to stop mid-sentence. */
export interface TtsEngine {
  /** Who is speaking, so Hindi uses the right verb forms ("कर सकती हूँ" for a woman). */
  gender?: Gender;
  encoding: "linear16" | "mulaw";
  rate: number;
  /** Identifies this voice for the acknowledgement cache: the same key means the same voice speaking the same way. */
  cacheKey?: string;
  /** Part of the cache key for settings that change how the same text sounds (a voice's speed and pitch), so cached lines are never played with old settings. */
  variant?: string;
  speak(text: string, signal: AbortSignal): AsyncIterable<Uint8Array>;
}

export type State = "listening" | "thinking" | "speaking";
export type ServerEvent =
  | { type: "ready"; audio: { encoding: "linear16" | "mulaw"; rate: number } }
  | { type: "state"; state: State }
  | { type: "partial"; text: string }
  | { type: "user"; text: string; turn: number; /** the caller kept talking: this replaces their previous line */ replace?: boolean }
  | { type: "assistant"; text: string; turn: number }
  | { type: "clear" }
  | { type: "timing"; turn: number; llmFirstTokenMs: number; firstSentenceMs: number; ttsFirstAudioMs: number; totalMs: number; /** when the caller first hears the real answer (after any acknowledgement), from the final transcript */ answerMs?: number; /** when the acknowledgement started, if one was played */ ackMs?: number; /** how long the company-knowledge search took (part of llmFirstTokenMs) */ groundMs?: number }
  | { type: "barge_in"; turn: number }
  | { type: "handoff"; reason: HandoffReason; message: string }
  | { type: "blocked"; reason: string; message: string }
  | { type: "notice"; message: string }
  | { type: "error"; message: string };

export interface ConversationOptions {
  stt: SttAdapter;
  llm: LlmAdapter;
  tts: TtsEngine;
  language: "en" | "hi" | "en-hi";
  systemPrompt: string;
  /** Extra instruction for this turn from what the caller just said and what they said before (for example, which language to answer in). */
  turnNote?: (lastUser: string, previousUser?: string) => string;
  /** Finds the company knowledge relevant to what the caller just said. Left out: answers use the model alone. */
  ground?: (userText: string, previousUserText?: string) => Promise<string[]>;
  /**
   * When to hand the call to a person: the caller asks for one, complains, or has a payment problem, and when the AI keeps
   * failing. The AI says the message, tells the client (the phone carrier transfers the call there), and stops answering.
   */
  handoff?: { enabled: HandoffEnabled; message?: { en: string; hi: string } };
  /** A short acknowledgement to play at once while the answer is prepared (not kept in the history). Return null for none. */
  ack?: (userText: string) => string | null;
  /** Spoken first, as the AI disclosure (SOP: every AI call opens with it). */
  greeting?: string;
  /** Spoken if the model fails before the caller hears anything (SOP: fallback message on errors). */
  fallback?: string;
  send(event: ServerEvent): void;
  sendAudio(chunk: Uint8Array): void;
  now?: () => number;
  /** Stop on raw VAD start; disable for browser playback, where the assistant's speaker audio can trigger VAD. */
  bargeOnVoice?: boolean;
  /** When a transcript stops mid-sentence ("my name is"), wait this long for the rest before answering. 0 = off. Lets the silence rule be short. */
  holdUnfinishedMs?: number;
  /** A browser call has nobody to transfer to: after the hand-over line the AI keeps listening and helping. A phone call really moves to a person. */
  resumeAfterHandoff?: boolean;
  maxHistory?: number;
  /** How long a chunk of audio plays. Defaults to deriving it from the byte count and the engine's format. */
  chunkDurationMs?: (chunk: Uint8Array) => number;
  log?: (line: string) => void;
}

interface ActiveTurn {
  ac: AbortController;
  turn: number;
  answerStarted: boolean;
  interruptedAt: number | null;
}

/** Acknowledgements already spoken in a voice, kept as audio so the next one plays at once (staff voices take up to 3 s to make a sentence). */
const ackCache = new Map<string, Uint8Array[]>();
const ackKey = (tts: TtsEngine, text: string) => (tts.cacheKey ? `${tts.cacheKey}|${text}` : null);
/** Answers already given to a question, in a voice and language, for the same company knowledge: asked again, they are spoken at once without waiting for AskG1. */
const answerCache = new Map<string, string[]>();
const remember = <V>(m: Map<string, V>, key: string, value: V, max: number) => { if (m.size >= max) m.delete(m.keys().next().value!); m.set(key, value); };

/** Makes an acknowledgement ahead of the first caller turn so even the first one is instant. Never throws. */
export async function primeAck(tts: TtsEngine, text: string): Promise<void> {
  const key = ackKey(tts, text);
  if (!key || ackCache.has(key)) return;
  try {
    const chunks: Uint8Array[] = [];
    for await (const c of tts.speak(text, new AbortController().signal)) chunks.push(new Uint8Array(c));
    if (chunks.length) ackCache.set(key, chunks);
  } catch { /* the acknowledgement is only a courtesy */ }
}

/** One live call: caller audio in, speech-to-text, AskG1, text-to-speech, audio out, with barge-in. */
export class Conversation {
  private session: SttSession | null = null;
  private state: State = "listening";
  private history: ChatMessage[] = [];
  private turn = 0;
  private active: ActiveTurn | null = null;
  private closed = false;
  private readonly now: () => number;
  /** When the audio sent so far finishes playing at the other end. We send far faster than real time. */
  private playbackEndsAt = 0;
  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  /** The opening greeting carries the AI and recording notice, so it is played in full: the speaker's own sound reaching the microphone must not cut it off. */
  private greetingPlaying = false;
  /** The assistant message in `history` and when each of its sentences began to play, so an interruption trims it. */
  private lastSpoken: { index: number; sentences: { text: string; playStart: number }[] } | null = null;
  private readonly t0: number;
  private readonly segments: TranscriptSegment[] = [];
  private speechStartedAt: number | null = null;
  private speechStartedDuringSuppressedAudio = false;
  private bargeInSuppressedUntil = 0;
  private handedOff: HandoffReason | null = null;
  private handoffSeen: HandoffReason | null = null; // kept for the call log when the call carries on after the hand-over line
  private errorStreak = 0;
  /** What was actually sent to the model for each caller line (with that turn's note), so later requests repeat it word for word. */
  private readonly sent = new WeakMap<ChatMessage, string>();

  constructor(private readonly o: ConversationOptions) {
    this.now = o.now ?? (() => performance.now());
    this.t0 = this.now();
  }

  /** The call so far, with times from the start of the call (saved to the call log when it ends). */
  transcript(): TranscriptSegment[] { return this.segments.map((s) => ({ ...s })); }
  /** Why the call was handed to a person, if it was. */
  handoffReason(): HandoffReason | null { return this.handedOff ?? this.handoffSeen; }
  durationMs(): number { return Math.max(0, this.now() - this.t0); }

  private handoffMessage(callerText: string): string {
    const m = this.o.handoff?.message;
    // The language chosen for the call decides; only a mixed call follows the caller's own script.
    const hindi = this.o.language === "hi" || (this.o.language === "en-hi" && /[\u0900-\u097F]/.test(callerText));
    return hindi ? (m?.hi ?? HANDOFF_HINDI) : (m?.en ?? HANDOFF_ENGLISH);
  }

  /** Hands the call over: the AI says so, the client is told, and the AI stops answering. */
  private markHandoff(reason: HandoffReason, callerText: string): string {
    this.handedOff = reason;
    const message = this.handoffMessage(callerText);
    this.o.send({ type: "handoff", reason, message });
    this.o.log?.(`handoff: ${reason}`);
    return message;
  }

  private openStt() {
    return this.o.stt.open({ language: this.o.language, encoding: "linear16", sampleRate: 16_000 });
  }

  async start(): Promise<void> {
    this.session = await this.openStt();
    this.o.send({ type: "ready", audio: { encoding: this.o.tts.encoding, rate: this.o.tts.rate } });
    void this.listen(this.session);
    if (this.o.greeting) { this.greetingPlaying = true; this.begin(null, this.o.greeting); }
  }

  pushAudio(frame: Uint8Array): void {
    if (!this.closed) this.session?.send(frame);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.playbackTimer) clearTimeout(this.playbackTimer);
    if (this.holdTimer) clearTimeout(this.holdTimer);
    this.active?.ac.abort();
    await this.session?.close().catch(() => {});
  }

  private chunkMs(chunk: Uint8Array): number {
    if (this.o.chunkDurationMs) return this.o.chunkDurationMs(chunk);
    const bytesPerSample = this.o.tts.encoding === "linear16" ? 2 : 1;
    return (chunk.length / bytesPerSample / this.o.tts.rate) * 1000;
  }

  private isPlaying(): boolean {
    return this.now() < this.playbackEndsAt;
  }

  /** Back to listening once everything already sent has finished playing. */
  private settleWhenQuiet() {
    if (this.playbackTimer) clearTimeout(this.playbackTimer);
    if (this.active) return;
    const wait = this.playbackEndsAt - this.now();
    if (wait <= 0) return this.setState("listening");
    this.playbackTimer = setTimeout(() => { if (!this.active && !this.closed) this.setState("listening"); }, wait + 20);
  }

  private setState(s: State) {
    if (this.state === s) return;
    this.state = s;
    if (s === "listening") {
      this.greetingPlaying = false;
      if (this.handedOff && this.o.resumeAfterHandoff) { this.handoffSeen = this.handedOff; this.handedOff = null; }
    }
    this.o.send({ type: "state", state: s });
  }

  /** Reads recogniser events. If the recogniser connection drops mid-call, reconnect (twice at most) instead of going deaf. */
  private async listen(first: SttSession) {
    let session = first;
    for (let attempt = 0; ; attempt++) {
      try {
        for await (const ev of session.events) {
          if (this.closed) return;
          this.onSttEvent(ev);
        }
      } catch (e) {
        this.o.log?.(`speech recognition error: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (this.closed) return;
      if (attempt >= 2) return void this.o.send({ type: "error", message: "speech recognition disconnected" });
      this.o.log?.("speech recognition disconnected, reconnecting");
      try {
        session = this.session = await this.openStt();
      } catch {
        return void this.o.send({ type: "error", message: "speech recognition disconnected" });
      }
    }
  }

  private onSttEvent(ev: SttEvent) {
    switch (ev.kind) {
      case "speech_started":
        {
          // If the caller resumes during the unfinished-text grace period, wait for that utterance's final transcript too.
          if (this.heldText && this.holdTimer) {
            clearTimeout(this.holdTimer);
            this.holdTimer = undefined;
            this.o.log?.("caller continued before the unfinished-turn wait expired");
          }
          const startedAt = this.now();
          this.speechStartedAt ??= startedAt;
          this.speechStartedDuringSuppressedAudio = startedAt < this.bargeInSuppressedUntil;
          if (this.o.bargeOnVoice !== false && this.state === "speaking" && startedAt >= this.bargeInSuppressedUntil) this.bargeIn();
        }
        break;
      case "partial":
        if (ev.text) {
          this.o.send({ type: "partial", text: ev.text });
          // Only real words (three or more letters) while the AI is speaking count as an interruption. Interim words that arrive while it is still
          // thinking belong to the same question (the next final joins them), and a short sound ("जी") can be the speaker's own echo.
          if (this.state === "speaking" && this.now() >= this.bargeInSuppressedUntil && [...ev.text].filter((c) => /\p{L}/u.test(c)).length >= 3) this.bargeIn();
        }
        break;
      case "final":
        if (ev.text && !this.handedOff) {
          const duringSuppressedAudio = this.speechStartedDuringSuppressedAudio || this.now() < this.bargeInSuppressedUntil;
          this.speechStartedDuringSuppressedAudio = false;
          if (this.o.bargeOnVoice === false && duringSuppressedAudio) {
            this.speechStartedAt = null;
            this.o.log?.("ignored transcript that started during acknowledgement audio");
            break;
          }
          this.o.log?.(`heard: ${ev.text}`);
          this.onFinalText(ev.text);
        }
        break;
      default:
        break;
    }
  }

  /** The caller spoke over the AI: stop audio, drop the reply being written, and listen. */
  private bargeIn() {
    if (this.greetingPlaying) return;
    const t = this.now();
    if (!this.active && !this.isPlaying()) return;
    const turn = this.active?.turn ?? this.turn;
    if (this.active) this.active.interruptedAt = t;
    this.active?.ac.abort();
    this.playbackEndsAt = t;
    if (this.playbackTimer) clearTimeout(this.playbackTimer);
    // If the reply was already fully sent, trim what we remember down to the sentences the caller actually heard.
    if (!this.active && this.lastSpoken) {
      const heard = this.lastSpoken.sentences.filter((s) => s.playStart <= t).map((s) => s.text);
      const m = this.history[this.lastSpoken.index];
      if (m) { if (heard.length) m.content = heard.join(" "); else this.history.splice(this.lastSpoken.index, 1); }
      this.lastSpoken = null;
    }
    const at = t - this.t0; // what the caller had not heard yet is not part of the call; what was cut mid-sentence is marked
    for (let i = this.segments.length - 1; i >= 0; i--) {
      const seg = this.segments[i]!;
      if (seg.speaker !== "ai" || seg.endMs <= at) break;
      if (seg.startMs >= at) this.segments.splice(i, 1);
      else { seg.interrupted = true; seg.endMs = Math.round(at); }
    }
    this.o.send({ type: "clear" });
    this.o.send({ type: "barge_in", turn });
    this.o.log?.(`barge-in on turn ${turn}`);
    if (!this.active) this.setState("listening");
  }

  /** A caller's finished piece of speech. If it stops mid-sentence, wait briefly for the rest; the pieces are then answered as one question. */
  private heldText: string | null = null;
  private holdTimer?: ReturnType<typeof setTimeout>;
  private onFinalText(text: string) {
    if (this.holdTimer) { clearTimeout(this.holdTimer); this.holdTimer = undefined; }
    if (this.heldText) { text = `${this.heldText} ${text}`; this.heldText = null; }
    const hold = this.o.holdUnfinishedMs ?? 0;
    if (hold > 0 && looksUnfinished(text)) {
      this.heldText = text;
      this.o.log?.(`waiting ${hold} ms: the caller may not have finished ("${text.slice(-30)}")`);
      this.holdTimer = setTimeout(() => { const t = this.heldText; this.heldText = null; this.holdTimer = undefined; if (t && !this.closed) this.begin(t); }, hold);
      return;
    }
    this.begin(text);
  }

  private begin(userText: string | null, scripted?: string) {
    if (userText) {
      const previousUser = this.history.filter((m) => m.role === "user").at(-1)?.content;
      userText = normalizeBizfyPlanQuestion(userText, previousUser);
    }
    if (userText) {
      this.bargeInSuppressedUntil = 0;
      // Some recognisers do not send partial text. A confirmed final transcript must still clear queued audio.
      if (this.state === "speaking" && this.isPlaying()) this.bargeIn();
    }
    // The caller paused mid-sentence and kept going before the AI said a word: treat both pieces as one question.
    let replace = false;
    if (userText && this.active && !this.active.answerStarted && this.history.at(-1)?.role === "user") {
      userText = `${this.history.pop()!.content} ${userText}`;
      replace = true;
      userText = normalizeBizfyPlanQuestion(userText);
    }
    this.active?.ac.abort();
    if (this.playbackTimer) clearTimeout(this.playbackTimer);
    this.lastSpoken = null;
    const turn = ++this.turn;
    const ac = new AbortController();
    const active: ActiveTurn = { ac, turn, answerStarted: false, interruptedAt: null };
    this.active = active;
    const tFinal = this.now();
    if (userText) {
      this.history.push({ role: "user", content: userText });
      this.o.send({ type: "user", text: userText, turn, ...(replace ? { replace } : {}) });
      const last = this.segments.at(-1);
      if (replace && last?.speaker === "caller") { last.text = userText; last.endMs = Math.round(tFinal - this.t0); }
      else this.segments.push({ speaker: "caller", startMs: Math.round((this.speechStartedAt ?? tFinal) - this.t0), endMs: Math.round(tFinal - this.t0), text: userText });
      this.speechStartedAt = null;
      let reason = this.o.handoff ? detectHandoff(userText, this.o.handoff.enabled) : null;
      // The AI just offered to connect a person and the caller said yes: do it, instead of asking the model again.
      if (!reason && this.o.handoff?.enabled.person && isAgreement(userText) && offeredHandoff(this.history.slice(0, -1).reverse().find((m) => m.role === "assistant")?.content)) reason = "person";
      if (reason) scripted = this.markHandoff(reason, userText);
      else if (userText) {
        scripted = replyToGreeting(userText, this.o.language, this.history.filter((m) => m.role === "user").at(-2)?.content)
          ?? replyToIdentityQuestion(userText, this.o.language)
          ?? replyToOrphanedPlanFragment(userText, this.o.language)
          ?? scripted;
      }
    }
    void this.run(active, tFinal, scripted);
  }

  private async run(active: ActiveTurn, tFinal: number, scripted?: string) {
    const { turn, ac } = active;
    const { signal } = ac;
    const spoken: { text: string; playStart: number }[] = [];
    let tFirstToken = 0, tFirstSentence = 0, tSpeakStart = 0, tFirstAudio = 0, failed = false, groundMs = 0, tAck = 0, tAnswerPlay = 0;
    let ackDone: Promise<void> = Promise.resolve();
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    this.setState("thinking");

    // The acknowledgement is synthesised alongside the AI request; the answer waits only for its audio to finish being produced.
    const sayAck = async (text: string, suppressBargeIn = false): Promise<void> => {
      const key = ackKey(this.o.tts, text);
      const cached = key ? ackCache.get(key) : undefined;
      const fresh: Uint8Array[] = [];
      for await (const chunk of cached ?? this.o.tts.speak(text, signal)) {
        if (signal.aborted) return;
        const t = this.now();
        if (!tAck) { tAck = t; this.setState("speaking"); }
        this.playbackEndsAt = Math.max(this.playbackEndsAt, t) + this.chunkMs(chunk);
        if (suppressBargeIn) this.bargeInSuppressedUntil = this.playbackEndsAt;
        this.o.sendAudio(chunk);
        if (!cached) fresh.push(new Uint8Array(chunk));
      }
      if (key && !cached && fresh.length) ackCache.set(key, fresh);
    };

    const say = async (raw: string): Promise<void> => {
      await ackDone;
      if (signal.aborted) return;
      raw = greetingFix(raw, this.o.language);
      const sentence = this.o.tts.gender ? matchGender(forVoice(raw), this.o.tts.gender) : forVoice(raw);
      if (!sentence || !/[\p{L}\p{N}]/u.test(sentence)) return; // nothing left to say once markup is removed
      if (!tSpeakStart) tSpeakStart = this.now();
      let playStart = -1;
      const skey = ackKey(this.o.tts, sentence), scached = skey ? ackCache.get(skey) : undefined, sfresh: Uint8Array[] = [];
      for await (const chunk of scached ?? this.o.tts.speak(sentence, signal)) {
        if (signal.aborted) return;
        if (!scached) sfresh.push(new Uint8Array(chunk));
        const t = this.now();
        if (!tFirstAudio) { tFirstAudio = t; this.setState("speaking"); if (this.active?.turn === turn) this.active.answerStarted = true; }
        if (playStart < 0) { playStart = Math.max(this.playbackEndsAt, t); if (!tAnswerPlay) tAnswerPlay = playStart; }
        this.playbackEndsAt = Math.max(this.playbackEndsAt, t) + this.chunkMs(chunk);
        this.o.sendAudio(chunk);
      }
      if (skey && !scached && !signal.aborted && sfresh.length) remember(ackCache, skey, sfresh, 400);
      if (!signal.aborted) {
        const startedAt = playStart < 0 ? this.now() : playStart;
        spoken.push({ text: sentence, playStart: startedAt });
        this.segments.push({ speaker: "ai", startMs: Math.round(startedAt - this.t0), endMs: Math.round(Math.max(this.playbackEndsAt, startedAt) - this.t0), text: sentence });
        this.o.send({ type: "assistant", text: sentence, turn });
      }
    };

    try {
      if (scripted) {
        await say(scripted);
      } else {
        const ackText = this.o.ack?.(this.history.at(-1)?.role === "user" ? this.history.at(-1)!.content : "") ?? null;
        if (ackText) ackDone = sayAck(ackText, true).catch(() => {});
        // AskG1 sometimes takes 10 to 40 s to start: after 6 s without a word the caller hears that we are still on it, instead of silence.
        // Not for small talk ("Hi, how are you?"): "one moment, I am checking that" makes no sense there.
        const askedSomething = !isSmallTalk(this.history.at(-1)?.role === "user" ? this.history.at(-1)!.content : "");
        waitTimer = setTimeout(() => { if (askedSomething && !tFirstToken && !signal.aborted) void ackDone.then(() => sayAck(stillWorking(this.o.language), true)).catch(() => {}); }, 6000);
        const lastUser = [...this.history].reverse().find((m) => m.role === "user")?.content ?? "";
        // Knowledge lookup must never stop a reply: if it fails the model answers without it and is told nothing matched.
        const tGround = this.now();
        const earlierUser = this.history.filter((m) => m.role === "user").at(-2)?.content;
        const passages = this.o.ground ? await this.o.ground(lastUser, earlierUser).catch(() => []) : [];
        groundMs = this.now() - tGround;
        if (signal.aborted) return;
        const missingPlan = this.o.ground ? unknownPlanReply(lastUser, passages, this.o.language, earlierUser) : null;
        if (missingPlan) {
          scripted = missingPlan;
          await say(missingPlan);
          return;
        }
        const userLines = this.history.filter((m) => m.role === "user");
        const note = this.o.turnNote?.(lastUser, userLines.length > 1 ? userLines[userLines.length - 2]!.content : undefined) ?? "";
        // The knowledge and the language note change every turn, so they ride on the newest user message instead of the
        // system prompt: that keeps the long system prompt and the earlier conversation identical from turn to turn, and
        // the model only has to read the new part.
        const extra = [this.o.ground ? knowledgeBlock(passages) : "", note.trim()].filter(Boolean).join("\n");
        const recent = this.history.slice(-(this.o.maxHistory ?? 20));
        const last = recent.at(-1);
        if (last && last.role === "user" && extra) this.sent.set(last, `${last.content}\n[note: ${extra}]`);
        // Earlier turns go out exactly as they did the first time, notes included, so the model's saved copy of the conversation still matches.
        const messages: ChatMessage[] = [{ role: "system", content: this.o.systemPrompt }, ...recent.map((m) => (m.role === "user" && this.sent.get(m)) ? { ...m, content: this.sent.get(m)! } : m)];
        // The language chosen for the call is final. A sentence in the wrong language is never spoken: if the reply starts that way
        // the model is asked again with a firm one-line instruction, and what still comes back wrong is dropped.
        const lang = this.o.language;
        let strict = false, violated = false, complete = true;
        const normQ = lastUser.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{M}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
        const cacheKey = this.o.tts.cacheKey && passages.length && normQ.split(" ").length >= 3 ? `${lang}|${this.o.tts.cacheKey}|${normQ}|${passages.join("|")}` : null;
        const cachedAnswer = cacheKey ? answerCache.get(cacheKey) : undefined;
        if (cachedAnswer) this.o.log?.("answered from the saved answer");
        const chat = cachedAnswer ? async function* () { yield cachedAnswer.join(" "); } : (a: Parameters<typeof this.o.llm.chat>[0]) => this.o.llm.chat(a);
        for (let attempt = 0; attempt < 2 && !signal.aborted; attempt++) {
          const chunker = new SentenceChunker(this.o.language === "en" ? {} : { eagerFirstChars: 14 }); // Hindi voice time grows with length: start on a shorter first piece
          let restart = false;
          const sendMessages = strict ? messages.map((m, i) => i === messages.length - 1 && m.role === "user" ? { ...m, content: `${m.content}\n${strictNote(lang)}` } : m) : messages;
          for await (const token of chat({ messages: sendMessages, signal })) {
            if (signal.aborted) break;
            if (!tFirstToken) tFirstToken = this.now();
            for (const sentence of chunker.push(token)) {
              if (wrongLanguage(sentence, lang)) {
                violated = true;
                if (attempt === 0 && !spoken.length) { restart = true; break; }
                continue;
              }
              const spokenSentence = dropFiller(sentence);
              if (!spokenSentence) continue; // only stalling ("Sure, let me check that."): the real acknowledgement is ack.ts, for real questions only
              if (!tFirstSentence) tFirstSentence = this.now();
              await say(spokenSentence);
              if (signal.aborted) break;
            }
            if (restart) break;
          }
          if (restart) { strict = true; this.o.log?.(`wrong language in the reply, asking again (${lang})`); continue; }
          if (!signal.aborted) {
            const rest = chunker.flush();
            // A long tail with no ending punctuation means the model ran out of room mid-sentence: never speak half a sentence.
            const cutOff = !!rest && rest.length > 24 && !/[.!?।…"')\]]\s*$/.test(rest);
            if (cutOff) complete = false;
            if (rest && !cutOff && wrongLanguage(rest, lang)) {
              violated = true;
              if (attempt === 0 && !spoken.length) { strict = true; this.o.log?.(`wrong language in the reply, asking again (${lang})`); continue; }
            } else if (rest && !cutOff && dropFiller(rest)) { if (!tFirstSentence) tFirstSentence = this.now(); await say(dropFiller(rest)); }
          }
          break;
        }
        if (violated && !spoken.length && !signal.aborted) await say(sorryAgain(lang));
        if (cacheKey && !cachedAnswer && complete && !violated && !signal.aborted && active.interruptedAt === null && spoken.length) remember(answerCache, cacheKey, spoken.map((x) => x.text), 300);
      }
    } catch (e) {
      if (!signal.aborted) {
        failed = true;
        this.o.send({ type: "error", message: e instanceof Error ? e.message : String(e) });
        const tooSlow = e instanceof Error && /did not answer in time/i.test(e.message);
        if (tooSlow) await say(askAgainSlow(this.o.language)).catch(() => {}); // a slow model is not a broken call: no hand-over, just ask again
        else if (!tFirstAudio && this.o.fallback) await say(this.o.fallback).catch(() => {});
        // The AI failed twice in a row: stop pretending it can help and hand the call to a person (SOP: any pipeline error).
        if (!tooSlow && ++this.errorStreak >= 2 && this.o.handoff && !this.handedOff) {
          const lastCaller = [...this.history].reverse().find((m) => m.role === "user")?.content ?? "";
          await say(this.markHandoff("pipeline_error", lastCaller)).catch(() => {});
        }
      }
    } finally {
      clearTimeout(waitTimer);
      // Whatever the caller actually heard goes into the history, so an interrupted reply is remembered as interrupted.
      const heard = active.interruptedAt === null ? spoken : spoken.filter((x) => x.playStart <= active.interruptedAt!);
      if (heard.length) {
        const said = heard.map((x) => x.text).join(" ");
        this.history.push({ role: "assistant", content: said });
        // The reply itself says "I am connecting you now": make that true, so the caller is not left talking to the AI.
        if (!scripted && !failed && !signal.aborted && this.o.handoff?.enabled.person && !this.handedOff && commitsToConnect(said)) {
          this.handedOff = "person";
          this.o.send({ type: "handoff", reason: "person", message: said });
          this.o.log?.("handoff: person (the AI said it was connecting the caller)");
        }
        if (active.interruptedAt === null) this.lastSpoken = { index: this.history.length - 1, sentences: spoken };
      }
      if (!failed && !signal.aborted && !scripted && tFirstToken) this.errorStreak = 0;
      if (tFirstAudio && !scripted && !failed) {
        this.o.send({
          type: "timing", turn,
          llmFirstTokenMs: Math.round(tFirstToken - tFinal), groundMs: Math.round(groundMs),
          firstSentenceMs: Math.round(tFirstSentence - tFinal),
          ttsFirstAudioMs: Math.round(tFirstAudio - tSpeakStart),
          totalMs: Math.round((tAck || tFirstAudio) - tFinal),
          answerMs: Math.round(tAnswerPlay - tFinal),
          ...(tAck ? { ackMs: Math.round(tAck - tFinal) } : {}),
        });
      }
      if (this.active?.turn === turn) {
        this.active = null;
        this.settleWhenQuiet();
      }
    }
  }
}
