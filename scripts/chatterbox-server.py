#!/usr/bin/env python3
"""Chatterbox Multilingual (MIT licence) as a small local voice server: Hindi and English in a person's own cloned voice, made directly
from a short recording of them, with no stock voice and no voice conversion in between.

  POST /tts   JSON {"text": "...", "language": "hi" | "en", "voice_id": "<profile providerVoiceId>"}  ->  audio/wav (24 kHz, 16-bit mono)
  GET  /health

The reference recording for a voice is <voices dir>/<voice_id>.ref.wav (10 to 60 s of clean speech, kept on this machine only).
Needs a GPU to be fast: on an Apple laptop it takes 10 to 25 times the length of the speech, on an NVIDIA GPU it is faster than real time.
Run:  .local/chatterbox-venv/bin/python scripts/chatterbox-server.py        (port 8771, CHATTERBOX_PORT / CHATTERBOX_DEVICE to change)
Then set CHATTERBOX_URL=http://127.0.0.1:8771 in apps/voice/.env.local to use it for Hindi and mixed calls.
"""
import io, json, os, re, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import torch, torchaudio as ta

PORT = int(os.environ.get("CHATTERBOX_PORT", "8771"))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
VOICES = os.environ.get("POCKET_TTS_VOICES_DIR", os.path.join(ROOT, ".local", "voices"))
DEVICE = os.environ.get("CHATTERBOX_DEVICE") or ("cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu")

from chatterbox.mtl_tts import ChatterboxMultilingualTTS
model = ChatterboxMultilingualTTS.from_pretrained(device=DEVICE)
lock = threading.Lock()  # one sentence at a time on the GPU
print(f"chatterbox ready on {DEVICE}, port {PORT}", flush=True)

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body=b"", ctype="text/plain"):
        self.send_response(code); self.send_header("content-type", ctype); self.send_header("content-length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        self._send(200, b"ok") if self.path == "/health" else self._send(404)
    def do_POST(self):
        if self.path != "/tts": return self._send(404)
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))))
            text, lang, vid = str(req["text"]).strip(), req.get("language", "hi"), str(req["voice_id"])
            if not re.fullmatch(r"[A-Za-z0-9-]{8,64}", vid) or lang not in ("hi", "en") or not text: return self._send(400, b"bad request")
            ref = os.path.join(VOICES, f"{vid}.ref.wav")
            if not os.path.exists(ref): return self._send(404, b"no reference recording for this voice")
            with lock:
                wav = model.generate(text, language_id=lang, audio_prompt_path=ref)
            buf = io.BytesIO(); ta.save(buf, wav.cpu(), model.sr, format="wav", encoding="PCM_S", bits_per_sample=16)
            self._send(200, buf.getvalue(), "audio/wav")
        except Exception as e:
            self._send(500, str(e).encode()[:300])

ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
