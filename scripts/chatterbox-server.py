#!/usr/bin/env python3
"""Chatterbox Multilingual (MIT licence) as a small voice server: English, Hindi and Hinglish in a person's own cloned voice, made
directly from a short recording of them, with no stock voice and no voice conversion in between.

  POST /tts   JSON {"text", "voice_id", "language": "auto" | "en" | "hi", optional "exaggeration", "cfg_weight", "temperature", "seed"} -> audio/wav (24 kHz, 16-bit mono)
  PUT  /voice/<id>   body: a WAV of the person (10 to 60 s of clean speech). Stored as <voices dir>/<id>.ref.wav
  HEAD /voice/<id>   200 when the server has that person's recording, 404 when not
  DELETE /voice/<id> removes the recording (use when consent is withdrawn)
  GET  /health

What makes it sound right (the reasons, so they are not undone by accident):
  * The text is cut into sentences, and each sentence into runs by script: Devanagari runs are spoken as Hindi, English-letter runs as
    English, so Hinglish ("काफ़ी time से बात नहीं हुई") has every word read by the language that can read it. Send Hinglish as Devanagari plus
    English words; the web app already converts typed Hinglish ("kafi time se baat nahi hui") that way.
  * The person's voice is analysed once and kept (not once per sentence), so every sentence has the same voice and the first sentence is faster.
  * Each run is checked: a run that is far too short or too long for its text (the model sometimes cuts off, babbles or loops) is made again
    with a different seed, up to 3 times, and the most plausible attempt wins.
  * Leading and trailing silence is trimmed, then natural pauses are put back (short between runs, longer between sentences), with tiny fades
    so there are no clicks, and the loudness is levelled so sentences do not jump in volume.

Needs a GPU to be fast: on an NVIDIA GPU it is faster than real time; on an Apple laptop it takes 10 to 25 times the length of the speech.
Run on the machine with the GPU:
  scripts/chatterbox-setup.sh                      (once: makes .local/chatterbox-venv and downloads the model)
  CHATTERBOX_HOST=0.0.0.0 CHATTERBOX_TOKEN=<a long random secret> .local/chatterbox-venv/bin/python scripts/chatterbox-server.py
Then, in apps/web/.env.local and apps/voice/.env.local:  CHATTERBOX_URL=http://<that machine>:8771   CHATTERBOX_TOKEN=<the same secret>
Recordings of people are biometric data: keep the server on a network you control (a VPN such as Tailscale), never open to the internet.
"""
import hmac, io, json, os, random, re, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import torch, torchaudio as ta

HOST = os.environ.get("CHATTERBOX_HOST", "127.0.0.1")
PORT = int(os.environ.get("CHATTERBOX_PORT", "8771"))
TOKEN = os.environ.get("CHATTERBOX_TOKEN", "")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
VOICES = os.environ.get("POCKET_TTS_VOICES_DIR", os.path.join(ROOT, ".local", "voices"))
DEVICE = os.environ.get("CHATTERBOX_DEVICE") or ("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")
if HOST not in ("127.0.0.1", "localhost") and not TOKEN:
    raise SystemExit("CHATTERBOX_TOKEN is required when the server listens on a network address (voice recordings are biometric data)")

from chatterbox.mtl_tts import ChatterboxMultilingualTTS
model = ChatterboxMultilingualTTS.from_pretrained(device=DEVICE)
SR = model.sr
lock = threading.Lock()  # one run at a time on the GPU
conds_cache: dict = {}   # voice id -> (recording mtime, prepared voice)
os.makedirs(VOICES, exist_ok=True)
print(f"chatterbox ready on {DEVICE}, {HOST}:{PORT}", flush=True)

ID_RE = re.compile(r"[A-Za-z0-9-]{8,64}")
DEVANAGARI = re.compile(r"[ऀ-ॿ]")
LATIN = re.compile(r"[A-Za-z]")
# Per language: (exaggeration, cfg_weight, temperature). A lower cfg_weight keeps the pace natural and stops the accent of the recording
# leaking into the other language; Hindi gets the lower value because most recordings are of English-speaking people.
DEFAULTS = {"en": (0.5, 0.5, 0.75), "hi": (0.5, 0.3, 0.7)}
PAUSE_RUN, PAUSE_COMMA, PAUSE_SENTENCE = 0.06, 0.22, 0.52  # seconds; each is varied by up to +-22% (a person never pauses exactly the same twice)
PAUSE_JITTER = float(os.environ.get("CHATTERBOX_PAUSE_JITTER", "0.22"))
MAX_CHARS = 240


def ref_path(vid): return os.path.join(VOICES, f"{vid}.ref.wav")


def split_sentences(text):
    """Sentences by . ! ? ।  and line breaks; anything longer than MAX_CHARS is cut again at commas, so no run is too long to say in one go."""
    out = []
    for s in re.findall(r"(?:[^.!?।\n]|\.(?=\w))+[.!?।]*", text):
        s = s.strip()
        if not re.search(r"\w", s): continue
        while len(s) > MAX_CHARS:
            cut = max(s.rfind(",", 0, MAX_CHARS), s.rfind(" ", 0, MAX_CHARS))
            cut = cut if cut > 40 else MAX_CHARS
            out.append(s[:cut + 1].strip()); s = s[cut + 1:].strip()
        if s: out.append(s)
    return out


def split_runs(sentence, forced):
    """Runs by script. Spaces, digits and punctuation stay with the run before them. forced = 'en' makes everything English."""
    if forced == "en" or not DEVANAGARI.search(sentence): return [(sentence, "en")]
    runs = []
    for tok in re.findall(r"\S+\s*", sentence):
        lang = "hi" if DEVANAGARI.search(tok) else "en" if LATIN.search(tok) else None
        if lang is None:
            if runs: runs[-1][0] += tok
            else: runs.append([tok, "hi"])
        elif runs and runs[-1][1] == lang: runs[-1][0] += tok
        else: runs.append([tok, lang])
    return [(t, l) for t, l in runs if re.search(r"\w", t)]


def voice_conds(vid, exaggeration):
    path = ref_path(vid)
    mtime = os.path.getmtime(path)
    hit = conds_cache.get(vid)
    if not hit or hit[0] != mtime:
        model.prepare_conditionals(path, exaggeration=exaggeration)
        conds_cache[vid] = (mtime, model.conds)
    model.conds = conds_cache[vid][1]


def plausible_seconds(text, lang):
    """Rough lower and upper bounds for how long these words take to say, to catch cut-off or looping output."""
    n = len(re.findall(r"\w", text))
    per = 0.075 if lang == "hi" else 0.065  # seconds per letter, at a normal pace
    return max(0.25, n * per * 0.45), n * per * 2.2 + 0.8


def trim(wav, floor_db=-42.0, keep=0.04):
    """Cuts leading and trailing near-silence, keeping a few milliseconds so the word edges are not clipped."""
    x = wav.flatten()
    if x.numel() < SR // 10: return x
    thr = x.abs().max().clamp_min(1e-5) * (10 ** (floor_db / 20))
    idx = (x.abs() > thr).nonzero()
    if idx.numel() == 0: return x
    k = int(SR * keep)
    return x[max(0, idx[0].item() - k): min(x.numel(), idx[-1].item() + k)]


def make_run(text, lang, vid, exag, cfg, temp, seed):
    lo, hi = plausible_seconds(text, lang)
    best, best_gap = None, 1e9
    for attempt in range(3):
        torch.manual_seed(seed + attempt * 7919)
        voice_conds(vid, exag)
        wav = trim(model.generate(text, language_id=lang, exaggeration=exag, cfg_weight=cfg, temperature=temp, repetition_penalty=2.0).cpu())
        secs = wav.numel() / SR
        gap = 0 if lo <= secs <= hi else min(abs(secs - lo), abs(secs - hi))
        if gap < best_gap: best, best_gap = wav, gap
        if gap == 0: break
    return best


def fade(x, ms=8):
    n = min(int(SR * ms / 1000), x.numel() // 2)
    if n > 0:
        r = torch.linspace(0, 1, n)
        x = x.clone(); x[:n] *= r; x[-n:] *= r.flip(0)
    return x


def synth(text, vid, language, exag=None, cfg=None, temp=None, seed=None):
    seed = int(seed) if seed is not None else 1234
    pieces, last = [], None
    sentences = split_sentences(text)
    for si, sentence in enumerate(sentences):
        runs = split_runs(sentence, "en" if language == "en" else None)
        for ri, (rt, lang) in enumerate(runs):
            d = DEFAULTS[lang]
            wav = make_run(rt, lang, vid, d[0] if exag is None else exag, d[1] if cfg is None else cfg, d[2] if temp is None else temp, seed + si * 31 + ri)
            if wav is None or wav.numel() == 0: continue
            if pieces:  # the pause before this run: longer after a sentence, medium after a comma, short between runs of one sentence
                gap = PAUSE_SENTENCE if ri == 0 else (PAUSE_COMMA if last and last.rstrip().endswith((",", ";", ":")) else PAUSE_RUN)
                gap *= 1 + (random.random() * 2 - 1) * PAUSE_JITTER
                pieces.append(torch.zeros(int(SR * gap)))
            pieces.append(fade(wav)); last = rt
    if not pieces: raise ValueError("nothing to say")
    out = torch.cat(pieces)
    rms = out.pow(2).mean().sqrt().clamp_min(1e-6)
    out = out * min(0.1 / rms, 0.89 / out.abs().max().clamp_min(1e-6))  # level to about -20 dBFS, never clipping
    return out.unsqueeze(0)


class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _send(self, code, body=b"", ctype="text/plain", extra=None):
        self.send_response(code); self.send_header("content-type", ctype); self.send_header("content-length", str(len(body)))
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD": self.wfile.write(body)

    def _auth(self):
        if not TOKEN: return True
        given = self.headers.get("authorization", "").removeprefix("Bearer ").strip()
        if hmac.compare_digest(given, TOKEN): return True
        self._send(401, b"unauthorized"); return False

    def _vid(self):
        m = re.fullmatch(r"/voice/([A-Za-z0-9-]{8,64})", self.path)
        return m.group(1) if m else None

    def do_GET(self):
        if self.path == "/health": return self._send(200, b"ok")
        self._send(404)

    def do_HEAD(self):
        if not self._auth(): return
        vid = self._vid()
        self._send(200 if vid and os.path.exists(ref_path(vid)) else 404)

    def do_PUT(self):
        if not self._auth(): return
        vid = self._vid()
        if not vid: return self._send(404)
        try:
            n = int(self.headers.get("content-length", "0"))
            if not 1000 < n < 25 * 1024 * 1024: return self._send(400, b"send a WAV between 1 KB and 25 MB")
            data = self.rfile.read(n)
            if data[:4] != b"RIFF" or data[8:12] != b"WAVE": return self._send(400, b"the recording must be a WAV file")
            tmp = ref_path(vid) + ".tmp"
            with open(tmp, "wb") as f: f.write(data)
            os.chmod(tmp, 0o600); os.replace(tmp, ref_path(vid))
            conds_cache.pop(vid, None)
            self._send(204)
        except Exception as e:
            self._send(500, str(e).encode()[:300])

    def do_DELETE(self):
        if not self._auth(): return
        vid = self._vid()
        if not vid: return self._send(404)
        conds_cache.pop(vid, None)
        try: os.remove(ref_path(vid))
        except FileNotFoundError: pass
        self._send(204)

    def do_POST(self):
        if self.path != "/tts": return self._send(404)
        if not self._auth(): return
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))))
            text, vid, lang = str(req["text"]).strip(), str(req["voice_id"]), req.get("language", "auto")
            if not ID_RE.fullmatch(vid) or lang not in ("auto", "en", "hi") or not text or len(text) > 12000: return self._send(400, b"bad request")
            if not os.path.exists(ref_path(vid)): return self._send(404, b"no reference recording for this voice")
            t0 = time.time()
            with lock:
                wav = synth(text, vid, lang, req.get("exaggeration"), req.get("cfg_weight"), req.get("temperature"), req.get("seed"))
            buf = io.BytesIO(); ta.save(buf, wav, SR, format="wav", encoding="PCM_S", bits_per_sample=16)
            self._send(200, buf.getvalue(), "audio/wav", {"x-seconds": f"{wav.shape[1] / SR:.2f}", "x-render-seconds": f"{time.time() - t0:.2f}"})
        except Exception as e:
            self._send(500, str(e).encode()[:300])


ThreadingHTTPServer((HOST, PORT), H).serve_forever()
