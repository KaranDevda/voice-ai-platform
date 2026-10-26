"""Local Hindi (and English) text-to-speech server using Kokoro (Apache 2.0). Run by pnpm dev:stack with .local/kokoro-venv.

POST /tts  JSON body: text, voice (hf_alpha, hf_beta, hm_omega, hm_psi, af_heart, am_michael, ...), lang (hi or en-us), speed
Returns a 16-bit mono WAV at 24 kHz. GET /health answers 200 once the model is loaded.
Kokoro has fixed voices: it does not clone anyone's voice.
"""
import io, json, os, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

MODELS = os.environ.get("KOKORO_MODELS", os.path.join(os.path.dirname(__file__), "..", ".local", "models"))
PORT = int(os.environ.get("KOKORO_PORT", "8768"))
kokoro = Kokoro(os.path.join(MODELS, "kokoro-v1.0.onnx"), os.path.join(MODELS, "voices-v1.0.bin"))
VOICES = set(kokoro.get_voices())
lock = threading.Lock()  # the model runs one sentence at a time

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
            with lock:
                samples, sr = kokoro.create(text, voice=voice, speed=speed, lang=lang)
        except Exception as e:  # never take the server down for one bad sentence
            return self._send(500, str(e)[:200].encode())
        buf = io.BytesIO(); sf.write(buf, np.asarray(samples), sr, format="WAV", subtype="PCM_16")
        self._send(200, buf.getvalue(), "audio/wav")

if __name__ == "__main__":
    print(f"Kokoro server on 127.0.0.1:{PORT} ({len(VOICES)} voices)", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
