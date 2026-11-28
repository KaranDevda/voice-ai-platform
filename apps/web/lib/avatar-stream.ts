/**
 * Client for the talking-avatar server (scripts/avatar_server.py, MuseTalk on a GPU).
 * The page already plays the AI's voice; this sends the same audio to the server, gets back video of the photo's face speaking it,
 * and draws each frame at exactly the moment its sound is played. To give the server time to draw the first frames, the voice of each
 * answer is started `delay` seconds late (the Live page asks `startDelay()` for that).
 *
 * Frames are small rectangles (the lower face, which is all that moves) drawn over the photo the page already has.
 */

interface Segment { id: number; startPerf: number; durMs: number; env: Float32Array; frames: (ImageBitmap | undefined)[]; count?: number }
interface Open { id: number; startAt: number; endAt: number; ctx: AudioContext; chunks: ArrayBuffer[]; samples: number; rate: number; first: boolean }
export interface AvatarStats { fps: number; renderMs: number; audioMs: number; firstFrameMs: number | null; late: number }

export class AvatarStream {
  /** Seconds the voice of each answer is held back so the first frames are ready in time. */
  delay = 1.3;
  ready = false;
  onStats?: (s: AvatarStats) => void;
  private ws!: WebSocket;
  private g: CanvasRenderingContext2D;
  private segs = new Map<number, Segment>();
  private cur: Open | null = null;
  private nextId = 1;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private raf = 0;
  private lastEnd = 0;
  private sentAt = new Map<number, number>();
  private lateFrames = 0;
  private showing: "idle" | "video" = "idle";

  private constructor(
    private canvas: HTMLCanvasElement, private idle: ImageBitmap, private fps: number,
    private patch: { x: number; y: number; w: number; h: number }, private size: { w: number; h: number },
  ) {
    canvas.width = size.w; canvas.height = size.h;
    this.g = canvas.getContext("2d")!;
    this.drawIdle();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Uploads the photo to the avatar server (it finds the face and prepares it), opens the live connection, and returns the ready stream. */
  static async connect(link: string, photo: Blob, canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<AvatarStream> {
    const base = link.trim().replace(/\/$/, "");
    const res = await fetch(`${base}/avatar`, { method: "POST", body: photo, headers: { "content-type": photo.type || "image/jpeg" }, signal });
    if (res.status === 401) throw new Error("The avatar link is wrong or has expired. Paste the AVATAR_URL line from the Colab notebook again.");
    const info = (await res.json().catch(() => ({}))) as { avatar_id?: string; w?: number; h?: number; fps?: number; patch?: { x: number; y: number; w: number; h: number }; error?: string };
    if (!res.ok || !info.avatar_id) throw new Error(info.error ?? `The avatar server could not use this photo (HTTP ${res.status}).`);
    const bitmap = await createImageBitmap(photo, { resizeWidth: info.w!, resizeHeight: info.h!, resizeQuality: "high" });
    const s = new AvatarStream(canvas, bitmap, info.fps ?? 20, info.patch!, { w: info.w!, h: info.h! });
    await s.open(`${base.replace(/^http/, "ws")}/stream/${info.avatar_id}`);
    return s;
  }

  private open(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url); ws.binaryType = "arraybuffer"; this.ws = ws;
      ws.onopen = () => { this.ready = true; resolve(); };
      ws.onerror = () => { this.ready = false; reject(new Error("Could not open the live video connection to the avatar server.")); };
      ws.onclose = () => { this.ready = false; };
      ws.onmessage = (m) => this.onMessage(m.data);
    });
  }

  private onMessage(data: ArrayBuffer | string) {
    if (typeof data === "string") {
      const j = JSON.parse(data) as { type: string; seg: number; frames?: number; render_ms?: number; audio_ms?: number };
      const seg = this.segs.get(j.seg);
      if (j.type === "done" && seg) {
        seg.count = j.frames;
        const first = this.firstSeen.get(j.seg) ?? null;
        this.onStats?.({ fps: this.fps, renderMs: j.render_ms ?? 0, audioMs: j.audio_ms ?? 0, firstFrameMs: first, late: this.lateFrames });
      }
      return;
    }
    const dv = new DataView(data); const id = dv.getUint32(0, true), idx = dv.getUint32(4, true);
    const seg = this.segs.get(id);
    if (!seg) return;
    if (!this.firstSeen.has(id)) this.firstSeen.set(id, Math.round(performance.now() - (this.sentAt.get(id) ?? performance.now())));
    void createImageBitmap(new Blob([data.slice(8)], { type: "image/jpeg" })).then((bm) => { if (this.segs.has(id)) seg.frames[idx] = bm; else bm.close(); });
  }
  private firstSeen = new Map<number, number>();

  /** How long to hold back the voice at the start of an answer, in seconds (0 when no video is connected). */
  startDelay(): number { return this.ready ? this.delay : 0; }

  /** Called for every chunk of the AI's voice, with the moment (AudioContext time) it will start playing. */
  push(pcm16: ArrayBuffer, rate: number, ctx: AudioContext, at: number, durationS: number) {
    if (!this.ready) return;
    // A gap after the last chunk means a new stretch of speech.
    if (this.cur && at > this.cur.endAt + 0.08) this.flush();
    if (!this.cur) this.cur = { id: this.nextId++, startAt: at, endAt: at, ctx, chunks: [], samples: 0, rate, first: at > this.lastEnd + 0.25 };
    this.cur.chunks.push(pcm16); this.cur.samples += pcm16.byteLength >> 1; this.cur.endAt = at + durationS;
    clearTimeout(this.timer);
    // The first stretch of an answer is kept short so frames start early; later ones are longer (less start-up cost per stretch).
    if (this.cur.samples / rate >= (this.cur.first ? 0.7 : 1.6)) this.flush();
    else this.timer = setTimeout(() => this.flush(), 160);
  }

  private toPerf(ctx: AudioContext, at: number): number {
    const t = ctx.getOutputTimestamp?.();
    return t && t.contextTime ? (t.performanceTime ?? performance.now()) + (at - t.contextTime) * 1000 : performance.now() + (at - ctx.currentTime) * 1000;
  }

  private flush() {
    clearTimeout(this.timer);
    const c = this.cur; this.cur = null;
    if (!c || !c.samples || this.ws.readyState !== 1) return;
    const bytes = new Uint8Array(8 + c.samples * 2);
    const dv = new DataView(bytes.buffer); dv.setUint32(0, c.id, true); dv.setUint32(4, c.rate, true);
    let o = 8; for (const b of c.chunks) { bytes.set(new Uint8Array(b), o); o += b.byteLength; }
    const durMs = (c.samples / c.rate) * 1000;
    const all = new Int16Array(bytes.buffer, 8, c.samples);
    const win = Math.max(1, Math.round(c.rate * 0.05)), env = new Float32Array(Math.ceil(c.samples / win));
    for (let k = 0; k < env.length; k++) { let e = 0; const a = k * win, b = Math.min(c.samples, a + win); for (let i = a; i < b; i++) e += all[i]! * all[i]!; env[k] = Math.sqrt(e / (b - a)) / 32768; }
    this.segs.set(c.id, { id: c.id, startPerf: this.toPerf(c.ctx, c.startAt), durMs, env, frames: [] });
    this.sentAt.set(c.id, performance.now());
    this.lastEnd = c.endAt;
    this.ws.send(bytes);
  }

  /** The caller interrupted the AI: forget everything that was queued. */
  clear() {
    clearTimeout(this.timer); this.cur = null; this.lastEnd = 0;
    for (const s of this.segs.values()) s.frames.forEach((b) => b?.close());
    this.segs.clear(); this.drawIdle();
  }

  private drawIdle() { this.paint(undefined, 0); this.showing = "idle"; }

  // Smoothed speech energy (0..1) and a slow-moving "gesture" phase: they drive head nods and sway so the person is never frozen.
  private energy = 0; private lastT = 0; private nod = 0; private beat = 0;

  /** Draws the photo (and the mouth patch) with natural motion: breathing, slow head sway, and nods that follow the voice. */
  private paint(bm: ImageBitmap | undefined, target: number) {
    const { w, h } = this.size, t = performance.now() / 1000, dt = Math.min(0.1, t - (this.lastT || t)); this.lastT = t;
    this.energy += (target - this.energy) * Math.min(1, dt * 8);
    const talk = Math.min(1, this.energy * 5);
    if (target > 0.12 && this.beat < t - 0.5) { this.beat = t; this.nod = 1; }          // a stressed syllable: a small nod
    this.nod = Math.max(0, this.nod - dt * 3);
    const breathe = Math.sin(t * 1.3) * 0.004;
    const rot = (Math.sin(t * 0.55) * 0.35 + Math.sin(t * 1.7) * 0.15 * talk) * Math.PI / 180;   // head tilt, degrees
    const dx = Math.sin(t * 0.4) * w * 0.003 + Math.sin(t * 1.1) * w * 0.002 * talk;
    const dy = Math.sin(t * 0.7) * h * 0.002 + this.nod * h * 0.006 * talk;
    const sc = 1.04 + breathe + talk * 0.004;                                             // slight zoom hides the edges while moving
    const g = this.g; g.save();
    g.translate(w / 2 + dx, h / 2 + dy); g.rotate(rot); g.scale(sc, sc); g.translate(-w / 2, -h / 2);
    g.drawImage(this.idle, 0, 0, w, h);
    if (bm) g.drawImage(bm, this.patch.x, this.patch.y);
    g.restore();
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    let active: Segment | undefined;
    for (const s of this.segs.values()) {
      if (now >= s.startPerf && now < s.startPerf + s.durMs + 80) active = s;
      else if (now > s.startPerf + s.durMs + 2500) { s.frames.forEach((b) => b?.close()); this.segs.delete(s.id); this.firstSeen.delete(s.id); this.sentAt.delete(s.id); }
    }
    if (!active) { this.paint(undefined, 0); this.showing = "idle"; return; }
    const want = Math.min(Math.floor(((now - active.startPerf) / 1000) * this.fps), (active.count ?? Infinity) - 1);
    let bm: ImageBitmap | undefined, i = want;
    while (i >= 0 && i > want - 6 && !(bm = active.frames[i])) i--;     // the newest frame that has arrived
    const level = active.env[Math.min(active.env.length - 1, Math.max(0, Math.floor((now - active.startPerf) / 50)))] ?? 0;
    if (!bm) { this.lateFrames++; return; }
    if (i !== want) this.lateFrames++;
    this.paint(bm, level);
    this.showing = "video";
  };

  destroy() {
    cancelAnimationFrame(this.raf); clearTimeout(this.timer); this.ready = false;
    try { this.ws.close(); } catch { /* already closed */ }
    this.clear(); this.idle.close();
  }
}
