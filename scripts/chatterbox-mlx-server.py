#!/usr/bin/env python3
"""Chatterbox Multilingual on Apple silicon (MLX): the same server as chatterbox-server.py (same endpoints, same Hinglish handling, pauses and
retries), but running on the Mac's own GPU through mlx-audio. Measured on an M4: about 1.7x real time (4.5 s of English in 8 s, 5.8 s of
Hindi in 9 s), against 12x to 40x for the PyTorch version on the same machine. Fast enough for Studio and for pre-made lines; not yet for live calls.

Run:  .local/mlx-venv/bin/python scripts/chatterbox-mlx-server.py          (port 8771; CHATTERBOX_PORT / CHATTERBOX_TOKEN / CHATTERBOX_HOST as in chatterbox-server.py)
Then set CHATTERBOX_URL=http://127.0.0.1:8771 in apps/web/.env.local (and apps/voice/.env.local) and restart them.
"""
import hmac, io, json, os, random, re, threading, time
from http.server import BaseHTTPRequestHandler, HTTPServer
import numpy as np, soundfile as sf
import mlx.core as mx
from mlx_audio.tts.utils import load_model

HOST = os.environ.get("CHATTERBOX_HOST", "127.0.0.1")
PORT = int(os.environ.get("CHATTERBOX_PORT", "8771"))
TOKEN = os.environ.get("CHATTERBOX_TOKEN", "")
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
VOICES = os.environ.get("POCKET_TTS_VOICES_DIR", os.path.join(ROOT, ".local", "voices"))
if HOST not in ("127.0.0.1", "localhost") and not TOKEN:
    raise SystemExit("CHATTERBOX_TOKEN is required when the server listens on a network address (voice recordings are biometric data)")

MODEL_ID = os.environ.get("CHATTERBOX_MLX_MODEL", "mlx-community/chatterbox-multilingual-v3")
model = load_model(MODEL_ID)
SR = int(getattr(model, "sample_rate", 24000))
lock = threading.Lock()  # one run at a time on the GPU
conds_cache: dict = {}   # voice id -> (recording mtime, prepared voice)
os.makedirs(VOICES, exist_ok=True)
print(f"chatterbox (MLX, Apple silicon) ready, {HOST}:{PORT}", flush=True)

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
    # A very short piece ("Hi!", "Okay.") made on its own comes out as babble ("Hi, bike"): join it to the sentence after it (or before it, at the end).
    merged = []
    for s in out:
        if merged and len(re.findall(r"\w", merged[-1])) < 8: merged[-1] = f"{merged[-1]} {s}"
        else: merged.append(s)
    if len(merged) > 1 and len(re.findall(r"\w", merged[-1])) < 8: merged[-2] = f"{merged[-2]} {merged.pop()}"
    return merged


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
        conds_cache[vid] = (mtime, model.prepare_conditionals(path, SR, exaggeration))
    return conds_cache[vid][1]


def plausible_seconds(text, lang):
    """Rough lower and upper bounds for how long these words take to say, to catch cut-off or looping output."""
    n = len(re.findall(r"\w", text))
    per = 0.075 if lang == "hi" else 0.065  # seconds per letter, at a normal pace
    return max(0.25, n * per * 0.45), n * per * 1.7 + 0.7


def trim(x, floor_db=-42.0, keep=0.04):
    """Cuts leading and trailing near-silence, keeping a few milliseconds so the word edges are not clipped."""
    x = x.reshape(-1)
    if x.size < SR // 10: return x
    thr = max(float(np.abs(x).max()), 1e-5) * (10 ** (floor_db / 20))
    idx = np.nonzero(np.abs(x) > thr)[0]
    if idx.size == 0: return x
    k = int(SR * keep)
    return x[max(0, idx[0] - k): min(x.size, idx[-1] + k)]


def make_run(text, lang, vid, exag, cfg, temp, seed):
    lo, hi = plausible_seconds(text, lang)
    best, best_gap = None, 1e9
    # The speech model makes 25 tokens a second. A line that runs on (it repeats itself and never stops) is cut at about 1.15x the longest plausible
    # length, so a bad try costs seconds instead of the 40 s of the model's own limit, and the next try can replace it.
    cap = max(40, int(hi * 25 * 1.15))
    for attempt in range(3):
        mx.random.seed(seed + attempt * 7919)
        conds = voice_conds(vid, exag)
        parts = [np.array(r.audio, dtype=np.float32).reshape(-1) for r in model.generate(text=text, conds=conds, lang_code=lang, exaggeration=exag, cfg_weight=cfg, temperature=temp, repetition_penalty=2.0, max_new_tokens=cap, verbose=False)]
        wav = trim(np.concatenate(parts)) if parts else np.zeros(0, dtype=np.float32)
        secs = wav.size / SR
        gap = 0 if lo <= secs <= hi else min(abs(secs - lo), abs(secs - hi))
        if gap < best_gap: best, best_gap = wav, gap
        if gap == 0: break
    return best


def fade(x, ms=8):
    n = min(int(SR * ms / 1000), x.size // 2)
    if n > 0:
        x = x.copy(); r = np.linspace(0, 1, n, dtype=np.float32); x[:n] *= r; x[-n:] *= r[::-1]
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
            if wav is None or wav.size == 0: continue
            if pieces:  # the pause before this run: longer after a sentence, medium after a comma, short between runs of one sentence
                gap = PAUSE_SENTENCE if ri == 0 else (PAUSE_COMMA if last and last.rstrip().endswith((",", ";", ":")) else PAUSE_RUN)
                gap *= 1 + (random.random() * 2 - 1) * PAUSE_JITTER
                pieces.append(np.zeros(int(SR * gap), dtype=np.float32))
            pieces.append(fade(wav)); last = rt
    if not pieces: raise ValueError("nothing to say")
    out = np.concatenate(pieces)
    rms = max(float(np.sqrt(np.mean(out ** 2))), 1e-6)
    out = out * min(0.1 / rms, 0.89 / max(float(np.abs(out).max()), 1e-6))  # level to about -20 dBFS, never clipping
    return out


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
            buf = io.BytesIO(); sf.write(buf, wav, SR, format="WAV", subtype="PCM_16")
            self._send(200, buf.getvalue(), "audio/wav", {"x-seconds": f"{wav.size / SR:.2f}", "x-render-seconds": f"{time.time() - t0:.2f}"})
        except Exception as e:
            self._send(500, str(e).encode()[:300])


# One request at a time, on the main thread: MLX streams belong to the thread that loaded the model ("There is no Stream(gpu, 0) in current thread"),
# and only one run can use the GPU at once anyway. Uploads and health checks wait while a line is being made.
HTTPServer((HOST, PORT), H).serve_forever()
