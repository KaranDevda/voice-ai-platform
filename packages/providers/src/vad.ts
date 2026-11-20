/**
 * Energy-based voice activity detector for 16 kHz 16-bit mono audio. Cuts a stream into utterances: it reports when
 * speech starts and, after enough trailing silence, the whole utterance. Good enough for a headset or a quiet room;
 * a trained detector (Silero) can replace it behind the same interface if noisy lines need it.
 */
export interface VadOptions {
  sampleRate?: number;
  /** Silence after speech that ends an utterance. Shorter is faster but cuts off people who pause. */
  endSilenceMs?: number;
  /** Voiced audio needed before we call it speech, so a click or cough does not count. */
  startMs?: number;
  /** Audio kept from before the speech began, so the first word is not clipped. */
  preRollMs?: number;
  maxUtteranceMs?: number;
  /** Utterances with less speech than this are dropped as noise. */
  minSpeechMs?: number;
  /** Quietest level treated as speech (0..1 of full scale). The real threshold rises with background noise. */
  floor?: number;
}

/** `level` is the average loudness (0..1) of the voiced frames: how close and how loud the speaker was. */
export type VadEvent = { kind: "start"; level: number } | { kind: "end"; pcm: Int16Array; speechMs: number; level: number };

const FRAME_MS = 20;

export class Vad {
  private readonly o: Required<VadOptions>;
  private readonly frameSamples: number;
  private carry = new Int16Array(0);
  private noise = 0.004;
  private speaking = false;
  private voiced = 0;
  private voicedSum = 0;
  private silenceMs = 0;
  private speechMs = 0;
  private levelSum = 0;
  private levelFrames = 0;
  private preRoll: Int16Array[] = [];
  private utter: Int16Array[] = [];

  constructor(opts: VadOptions = {}) {
    this.o = { sampleRate: 16_000, endSilenceMs: 400, startMs: 100, preRollMs: 800, maxUtteranceMs: 25_000, minSpeechMs: 250, floor: 0.012, ...opts };
    this.frameSamples = Math.round((this.o.sampleRate * FRAME_MS) / 1000);
  }

  /** Feed any amount of audio; returns the events it completed. */
  push(samples: Int16Array): VadEvent[] {
    const all = new Int16Array(this.carry.length + samples.length);
    all.set(this.carry); all.set(samples, this.carry.length);
    const out: VadEvent[] = [];
    let at = 0;
    for (; at + this.frameSamples <= all.length; at += this.frameSamples) this.frame(all.slice(at, at + this.frameSamples), out);
    this.carry = all.slice(at);
    return out;
  }

  /** Call when the stream ends so a half-finished utterance is not lost. */
  flush(): VadEvent[] {
    const out: VadEvent[] = [];
    if (this.speaking) this.finish(out);
    return out;
  }

  private frame(f: Int16Array, out: VadEvent[]) {
    let sum = 0;
    for (let i = 0; i < f.length; i++) { const v = f[i]! / 32768; sum += v * v; }
    const rms = Math.sqrt(sum / f.length);
    const threshold = Math.max(this.o.floor, this.noise * 3);
    const loud = rms > threshold;
    if (!this.speaking) {
      if (!loud) this.noise = this.noise * 0.95 + rms * 0.05; // learn the background level while it is quiet
      this.preRoll.push(f);
      if (this.preRoll.length > this.o.preRollMs / FRAME_MS) this.preRoll.shift();
      this.voiced = loud ? this.voiced + 1 : 0;
      this.voicedSum = loud ? this.voicedSum + rms : 0;
      if (this.voiced * FRAME_MS >= this.o.startMs) {
        this.speaking = true;
        this.utter = [...this.preRoll];
        this.speechMs = this.voiced * FRAME_MS;
        this.levelSum = rms * this.voiced; this.levelFrames = this.voiced; // the frames that triggered the start were all loud
        this.silenceMs = 0;
        out.push({ kind: "start", level: this.voicedSum / this.voiced });
      }
      return;
    }
    this.utter.push(f);
    if (loud) { this.silenceMs = 0; this.speechMs += FRAME_MS; this.levelSum += rms; this.levelFrames++; } else this.silenceMs += FRAME_MS;
    if (this.silenceMs >= this.o.endSilenceMs || this.utter.length * FRAME_MS >= this.o.maxUtteranceMs) this.finish(out);
  }

  private finish(out: VadEvent[]) {
    // Drop most of the trailing silence but keep a little so the last word is not clipped.
    const keepTail = Math.min(this.silenceMs, 120) / FRAME_MS;
    const frames = this.utter.slice(0, this.utter.length - Math.max(0, this.silenceMs / FRAME_MS - keepTail));
    const pcm = new Int16Array(frames.length * this.frameSamples);
    frames.forEach((fr, i) => pcm.set(fr, i * this.frameSamples));
    const speechMs = this.speechMs, level = this.levelFrames ? this.levelSum / this.levelFrames : 0;
    this.speaking = false; this.voiced = 0; this.silenceMs = 0; this.speechMs = 0; this.levelSum = 0; this.levelFrames = 0; this.utter = []; this.preRoll = [];
    if (speechMs >= this.o.minSpeechMs) out.push({ kind: "end", pcm, speechMs, level });
  }
}
