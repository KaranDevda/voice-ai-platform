"""Local Hindi (and English) text-to-speech server using Kokoro (Apache 2.0). Run by pnpm dev:stack with .local/kokoro-venv.

POST /tts  JSON body: text, voice (hf_alpha, hf_beta, hm_omega, hm_psi, af_heart, am_michael, ...), lang (hi or en-us), speed
Returns a 16-bit mono WAV at 24 kHz. GET /health answers 200 once the model is loaded.
Kokoro has fixed voices: it does not clone anyone's voice.
"""
import io, json, os, threading
from concurrent.futures import ProcessPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

MODELS = os.environ.get("KOKORO_MODELS", os.path.join(os.path.dirname(__file__), "..", ".local", "models"))
PORT = int(os.environ.get("KOKORO_PORT", "8768"))
# Several copies of the model, each in its own process, so several callers are spoken to at the same time. One copy needs 1.9 s per
# Hindi sentence and handles one sentence at a time, so eight callers used to queue for up to 8 s; a copy with 3 threads is almost as fast
# (2.1 s against 1.9 s with all of them), so 3 copies give about three times the throughput. KOKORO_WORKERS=1 is the old behaviour.
WORKERS = int(os.environ.get("KOKORO_WORKERS", "3"))
THREADS = int(os.environ.get("KOKORO_THREADS", "3"))
_model = None


def _load():
    import onnxruntime as ort
    so = ort.SessionOptions()
    so.intra_op_num_threads = THREADS
    session = ort.InferenceSession(os.path.join(MODELS, "kokoro-v1.0.onnx"), sess_options=so, providers=["CPUExecutionProvider"])
    return Kokoro.from_session(session, os.path.join(MODELS, "voices-v1.0.bin"))


def _init():
    global _model
    _model = _load()
    _model.create("नमस्ते।", voice="hf_alpha", lang="hi")  # warm up, so the first caller does not pay for it


def _speak(text, voice, speed, lang):
    samples, sr = _model.create(text, voice=voice, speed=speed, lang=lang)
    return np.asarray(samples), sr


VOICES = set(Kokoro(os.path.join(MODELS, "kokoro-v1.0.onnx"), os.path.join(MODELS, "voices-v1.0.bin")).get_voices())
pool = None
# The sentences callers hear most (the greeting, "How can I help you today?") are the same every time: keep the last 200 as audio.
cache, cache_lock = {}, threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body=b"", ctype="text/plain"):
        self.send_response(code); self.send_header("content-type", ctype); self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        self._send(200, b"ok") if self.path in ("/", "/health") else self._send(404)
    def do_POST(self):
        if self.path != "/tts": return self._send(404)
        try:
            n = int(self.headers.get("content-length") or 0)
            if n > 20000: return self._send(413)
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._send(400, b"send JSON")
        text = str(body.get("text") or "").strip()
        voice = str(body.get("voice") or "hf_alpha")
        lang = str(body.get("lang") or ("hi" if voice[0] == "h" else "en-us"))
        if not text or len(text) > 2000: return self._send(400, b"text must be 1 to 2000 characters")
        if voice not in VOICES: return self._send(400, b"unknown voice")
        if lang not in ("hi", "en-us"): return self._send(400, b"unknown language")
        try:
            speed = min(1.3, max(0.7, float(body.get("speed") or 1.0)))
            key = (text, voice, speed, lang)
            with cache_lock: hit = cache.get(key)
            if hit is not None: return self._send(200, hit, "audio/wav")
            samples, sr = pool.submit(_speak, text, voice, speed, lang).result()
        except Exception as e:  # never take the server down for one bad sentence
            return self._send(500, str(e)[:200].encode())
        buf = io.BytesIO(); sf.write(buf, np.asarray(samples), sr, format="WAV", subtype="PCM_16")
        wav = buf.getvalue()
        with cache_lock:
            if len(cache) >= 200: cache.pop(next(iter(cache)))
            cache[key] = wav
        self._send(200, wav, "audio/wav")

if __name__ == "__main__":
    pool = ProcessPoolExecutor(max_workers=WORKERS, initializer=_init)
    list(pool.map(_speak, ["नमस्ते।"] * WORKERS, ["hf_alpha"] * WORKERS, [1.0] * WORKERS, ["hi"] * WORKERS))  # start every worker before taking calls
    print(f"Kokoro server on 127.0.0.1:{PORT} ({len(VOICES)} voices)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
