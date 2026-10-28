import type { ChatMessage, LlmAdapter, SttAdapter, SttEvent, SttSession } from "@voiceai/providers";
import { SentenceChunker } from "./sentences";
import { knowledgeBlock } from "./prompt";
import { forVoice } from "./speech-text";
import { matchGender, type Gender } from "./gender";
import { detectHandoff, HANDOFF_ENGLISH, HANDOFF_HINDI, type HandoffEnabled, type HandoffReason } from "./handoff";
import type { TranscriptSegment } from "@voiceai/shared";

/** Speaks text as audio chunks in the engine's native format. Abort the signal to stop mid-sentence. */
export interface TtsEngine {
  /** Who is speaking, so Hindi uses the right verb forms ("कर सकती हूँ" for a woman). */
  gender?: Gender;
  encoding: "linear16" | "mulaw";
  rate: number;
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
  | { type: "timing"; turn: number; llmFirstTokenMs: number; firstSentenceMs: number; ttsFirstAudioMs: number; totalMs: number; /** how long the company-knowledge search took (part of llmFirstTokenMs) */ groundMs?: number }
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
  ground?: (userText: string) => Promise<string[]>;
  /**
   * When to hand the call to a person: the caller asks for one, complains, or has a payment problem, and when the AI keeps
   * failing. The AI says the message, tells the client (the phone carrier transfers the call there), and stops answering.
   */
  handoff?: { enabled: HandoffEnabled; message?: { en: string; hi: string } };
  /** Spoken first, as the AI disclosure (SOP: every AI call opens with it). */
  greeting?: string;
  /** Spoken if the model fails before the caller hears anything (SOP: fallback message on errors). */
  fallback?: string;
  send(event: ServerEvent): void;
  sendAudio(chunk: Uint8Array): void;
  now?: () => number;
  /** Stop the AI the moment the recogniser hears the caller start, not only when words arrive. */
  bargeOnVoice?: boolean;
  maxHistory?: number;
  /** How long a chunk of audio plays. Defaults to deriving it from the byte count and the engine's format. */
  chunkDurationMs?: (chunk: Uint8Array) => number;
  log?: (line: string) => void;
}

/** One live call: caller audio in, speech-to-text, AskG1, text-to-speech, audio out, with barge-in. */
export class Conversation {
  private session: SttSession | null = null;
  private state: State = "listening";
  private history: ChatMessage[] = [];
  private turn = 0;
  private active: { ac: AbortController; turn: number; audio: boolean } | null = null;
  private closed = false;
  private readonly now: () => number;
  /** When the audio sent so far finishes playing at the other end. We send far faster than real time. */
  private playbackEndsAt = 0;
  private playbackTimer: ReturnType<typeof setTimeout> | null = null;
  private bargedAt: number | null = null;
  /** The assistant message in `history` and when each of its sentences began to play, so an interruption trims it. */
  private lastSpoken: { index: number; sentences: { text: string; playStart: number }[] } | null = null;
  private readonly t0: number;
  private readonly segments: TranscriptSegment[] = [];
  private speechStartedAt: number | null = null;
  private handedOff: HandoffReason | null = null;
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
  handoffReason(): HandoffReason | null { return this.handedOff; }
  durationMs(): number { return Math.max(0, this.now() - this.t0); }

  private handoffMessage(callerText: string): string {
    const m = this.o.handoff?.message;
    return /[\u0900-\u097F]/.test(callerText) ? (m?.hi ?? HANDOFF_HINDI) : (m?.en ?? HANDOFF_ENGLISH);
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
    if (this.o.greeting) this.begin(null, this.o.greeting);
  }

  pushAudio(frame: Uint8Array): void {
    if (!this.closed) this.session?.send(frame);
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.playbackTimer) clearTimeout(this.playbackTimer);
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
        this.speechStartedAt ??= this.now();
        if (this.o.bargeOnVoice !== false && this.state === "speaking") this.bargeIn();
        break;
      case "partial":
        if (ev.text) {
          this.o.send({ type: "partial", text: ev.text });
          if (this.state !== "listening") this.bargeIn();
        }
        break;
      case "final":
        if (ev.text && !this.handedOff) { this.o.log?.(`heard: ${ev.text}`); this.begin(ev.text); }
        break;
      default:
        break;
    }
  }

  /** The caller spoke over the AI: stop audio, drop the reply being written, and listen. */
  private bargeIn() {
    const t = this.now();
    if (!this.active && !this.isPlaying()) return;
    const turn = this.active?.turn ?? this.turn;
    this.bargedAt = t;
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

  private begin(userText: string | null, scripted?: string) {
    // The caller paused mid-sentence and kept going before the AI said a word: treat both pieces as one question.
    let replace = false;
    if (userText && this.active && !this.active.audio && this.history.at(-1)?.role === "user") {
      userText = `${this.history.pop()!.content} ${userText}`;
      replace = true;
    }
    this.active?.ac.abort();
    if (this.playbackTimer) clearTimeout(this.playbackTimer);
    this.lastSpoken = null;
    this.bargedAt = null;
    const turn = ++this.turn;
    const ac = new AbortController();
    this.active = { ac, turn, audio: false };
    const tFinal = this.now();
    if (userText) {
      this.history.push({ role: "user", content: userText });
      this.o.send({ type: "user", text: userText, turn, ...(replace ? { replace } : {}) });
      const last = this.segments.at(-1);
      if (replace && last?.speaker === "caller") { last.text = userText; last.endMs = Math.round(tFinal - this.t0); }
      else this.segments.push({ speaker: "caller", startMs: Math.round((this.speechStartedAt ?? tFinal) - this.t0), endMs: Math.round(tFinal - this.t0), text: userText });
      this.speechStartedAt = null;
      const reason = this.o.handoff ? detectHandoff(userText, this.o.handoff.enabled) : null;
      if (reason) scripted = this.markHandoff(reason, userText);
    }
    void this.run(turn, ac, tFinal, scripted);
  }

  private async run(turn: number, ac: AbortController, tFinal: number, scripted?: string) {
    const { signal } = ac;
    const spoken: { text: string; playStart: number }[] = [];
    let tFirstToken = 0, tFirstSentence = 0, tSpeakStart = 0, tFirstAudio = 0, failed = false, groundMs = 0;
    this.setState("thinking");

    const say = async (raw: string): Promise<void> => {
      const sentence = this.o.tts.gender ? matchGender(forVoice(raw), this.o.tts.gender) : forVoice(raw);
      if (!sentence || !/[\p{L}\p{N}]/u.test(sentence)) return; // nothing left to say once markup is removed
      if (!tSpeakStart) tSpeakStart = this.now();
      let playStart = -1;
      for await (const chunk of this.o.tts.speak(sentence, signal)) {
        if (signal.aborted) return;
        const t = this.now();
        if (!tFirstAudio) { tFirstAudio = t; this.setState("speaking"); if (this.active?.turn === turn) this.active.audio = true; }
        if (playStart < 0) playStart = Math.max(this.playbackEndsAt, t);
        this.playbackEndsAt = Math.max(this.playbackEndsAt, t) + this.chunkMs(chunk);
        this.o.sendAudio(chunk);
      }
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
        const chunker = new SentenceChunker();
        const lastUser = [...this.history].reverse().find((m) => m.role === "user")?.content ?? "";
        // Knowledge lookup must never stop a reply: if it fails the model answers without it and is told nothing matched.
        const tGround = this.now();
        const passages = this.o.ground ? await this.o.ground(lastUser).catch(() => []) : [];
        groundMs = this.now() - tGround;
        if (signal.aborted) return;
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
        for await (const token of this.o.llm.chat({ messages, signal })) {
          if (signal.aborted) break;
          if (!tFirstToken) tFirstToken = this.now();
          for (const sentence of chunker.push(token)) {
            if (!tFirstSentence) tFirstSentence = this.now();
            await say(sentence);
            if (signal.aborted) break;
          }
        }
        if (!signal.aborted) {
          const rest = chunker.flush();
          // A long tail with no ending punctuation means the model ran out of room mid-sentence: never speak half a sentence.
          const cutOff = !!rest && rest.length > 24 && !/[.!?।…"')\]]\s*$/.test(rest);
          if (rest && !cutOff) { if (!tFirstSentence) tFirstSentence = this.now(); await say(rest); }
        }
      }
    } catch (e) {
      if (!signal.aborted) {
        failed = true;
        this.o.send({ type: "error", message: e instanceof Error ? e.message : String(e) });
        if (!tFirstAudio && this.o.fallback) await say(this.o.fallback).catch(() => {});
        // The AI failed twice in a row: stop pretending it can help and hand the call to a person (SOP: any pipeline error).
        if (++this.errorStreak >= 2 && this.o.handoff && !this.handedOff) {
          const lastCaller = [...this.history].reverse().find((m) => m.role === "user")?.content ?? "";
          await say(this.markHandoff("pipeline_error", lastCaller)).catch(() => {});
        }
      }
    } finally {
      // Whatever the caller actually heard goes into the history, so an interrupted reply is remembered as interrupted.
      const heard = this.bargedAt === null ? spoken : spoken.filter((x) => x.playStart <= this.bargedAt!);
      if (heard.length) {
        this.history.push({ role: "assistant", content: heard.map((x) => x.text).join(" ") });
        if (this.bargedAt === null) this.lastSpoken = { index: this.history.length - 1, sentences: spoken };
      }
      if (!failed && !signal.aborted && !scripted && tFirstToken) this.errorStreak = 0;
      if (tFirstAudio && !scripted && !failed) {
        this.o.send({
          type: "timing", turn,
          llmFirstTokenMs: Math.round(tFirstToken - tFinal), groundMs: Math.round(groundMs),
          firstSentenceMs: Math.round(tFirstSentence - tFinal),
          ttsFirstAudioMs: Math.round(tFirstAudio - tSpeakStart),
          totalMs: Math.round(tFirstAudio - tFinal),
        });
      }
      if (this.active?.turn === turn) {
        this.active = null;
        this.settleWhenQuiet();
      }
    }
  }
}
