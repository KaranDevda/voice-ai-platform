"""Local voice-conversion server (OpenVoice v2 tone-colour converter, MIT). Run by pnpm dev:stack with .local/ov-venv.

It makes Hindi and Hinglish speech sound like a cloned staff member. Kokoro speaks the Hindi well but in a fixed voice; this
changes only the timbre of that audio to the person's, keeping the words and rhythm.

POST /embed?id=<voice id>    body: a WAV recording of the person.     Stores their voice fingerprint (<id>.se.pt in the voices folder).
POST /convert?id=<voice id>  body: a WAV (Kokoro's speech).           Returns a 24 kHz 16-bit mono WAV in the person's voice.
                             The converter changes timbre only, not pitch. Matching the pitch (stored at /embed time in <id>.f0) is available
                             with VOICE_CONVERT_PITCH_MATCH=1 but is off: it made the words harder to understand.
POST /score?id=<voice id>    body: a WAV. Returns JSON {"similarity": cosine to the voice fingerprint} (1.0 = identical), to tune quality.
GET  /health                 200 when the model is loaded.
Bound to 127.0.0.1 only. A voice fingerprint is biometric data: it lives in the voices folder and is deleted with the voice.
"""
import hashlib, io, json, os, re, sys, tempfile, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, ".local", "openvoice"))
import librosa, numpy as np, soundfile as sf, torch  # noqa: E402
from openvoice.api import OpenVoiceBaseClass, ToneColorConverter  # noqa: E402

MODEL_DIR = os.path.join(ROOT, ".local", "models", "openvoice-v2", "converter")
VOICES = os.environ.get("POCKET_TTS_VOICES_DIR") or os.path.join(ROOT, ".local", "voices")
PORT = int(os.environ.get("VOICE_CONVERT_PORT", "8769"))
# "mps" runs the same model on the Apple GPU (several times faster than "cpu"); the voice is the same model and the same fingerprint.
DEVICE = os.environ.get("VOICE_CONVERT_DEVICE", "cpu")
OUT_RATE = 24000          # what the rest of the platform plays; OpenVoice itself works at 22.05 kHz
TAU = os.environ.get("VOICE_CONVERT_TAU", "0.3")  # how freely the converter reshapes the voice; /convert?tau= overrides it per request
MAX_BODY = 20 * 1024 * 1024
MAX_SECONDS = 90
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


class Converter(ToneColorConverter):
    """OpenVoice's own constructor cannot switch the audio watermark off (it forwards the option to a parent that rejects it),
    and the watermark library is not needed, so this sets up the same state without it."""

    def __init__(self, config_path, device="cpu"):
        OpenVoiceBaseClass.__init__(self, config_path, device)
        self.watermark_model = None
        self.version = getattr(self.hps, "_version_", "v1")


conv = Converter(os.path.join(MODEL_DIR, "config.json"), device=DEVICE)
conv.load_ckpt(os.path.join(MODEL_DIR, "checkpoint.pth"))
lock = threading.Lock()  # one conversion at a time; the model is not built for parallel calls
# The same sentence in the same person's voice (the greeting, common answers) is made once: the last 100 are kept as audio.
converted = {}
fingerprints = {}        # voice id -> (file modified time, tensor), so each call does not re-read the file


def median_f0(y, sr, fmin=60, fmax=450):
    """Median pitch (Hz) of the voiced parts, by autocorrelation. None when there is no clear voiced speech."""
    y = np.asarray(y, dtype=np.float32)[: sr * 40]
    frame, hop = int(sr * 0.04), int(sr * 0.01)
    lo, hi = int(sr / fmax), int(sr / fmin)
    found = []
    for i in range(0, len(y) - frame, hop):
        x = y[i:i + frame] - y[i:i + frame].mean()
        if float(np.sqrt((x * x).mean())) < 0.02:
            continue
        ac = np.correlate(x, x, "full")[frame - 1:]
        if ac[0] <= 0:
            continue
        k = int(ac[lo:hi].argmax()) + lo
        if ac[k] / ac[0] > 0.45:
            found.append(sr / k)
    return float(np.median(found)) if len(found) >= 20 else None


def f0_path(voice_id):
    return os.path.join(VOICES, f"{voice_id}.f0")


def load_f0(voice_id):
    try:
        return float(open(f0_path(voice_id)).read().strip())
    except (OSError, ValueError):
        return None


# OFF by default. Measured on 26 Oct: shifting the speech to the person's pitch lowered the Hindi words a listener (Whisper) could
# understand from 75% to 60%, because the pitch shifter smears consonants ("eats words"). A clearer voice that is a few semitones off
# is better than the right pitch that is hard to understand. Set VOICE_CONVERT_PITCH_MATCH=1 to try it again.
PITCH_MATCH = os.environ.get("VOICE_CONVERT_PITCH_MATCH") == "1"
MAX_SHIFT = 2.0  # semitones


def fingerprint_path(voice_id):
    return os.path.join(VOICES, f"{voice_id}.se.pt")


def load_fingerprint(voice_id):
    path = fingerprint_path(voice_id)
    mtime = os.path.getmtime(path)  # raises FileNotFoundError when the voice has none
    cached = fingerprints.get(voice_id)
    if cached and cached[0] == mtime:
        return cached[1]
    se = torch.load(path, map_location="cpu").to(DEVICE)
    fingerprints[voice_id] = (mtime, se)
    return se


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _send(self, code, body=b"", ctype="text/plain"):
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_wav(self):
        n = int(self.headers.get("content-length") or 0)
        if n <= 44 or n > MAX_BODY:
            return None
        fd, path = tempfile.mkstemp(suffix=".wav")
        with os.fdopen(fd, "wb") as f:
            f.write(self.rfile.read(n))
        try:
            info = sf.info(path)
            if info.duration > MAX_SECONDS or info.duration < 0.5:
                os.remove(path)
                return None
        except Exception:
            os.remove(path)
            return None
        return path

    def do_GET(self):
        self._send(200, b"ok") if self.path in ("/", "/health") else self._send(404)

    def do_POST(self):
        url = urlparse(self.path)
        voice_id = (parse_qs(url.query).get("id") or [""])[0]
        if url.path not in ("/embed", "/convert", "/score"):
            return self._send(404)
        if not UUID.match(voice_id):
            return self._send(400, b"bad voice id")
        wav = self._read_wav()
        if wav is None:
            return self._send(400, b"send a WAV of 0.5 to 90 seconds")
        try:
            with lock:
                if url.path == "/embed":
                    se = conv.extract_se([wav])
                    os.makedirs(VOICES, exist_ok=True)
                    tmp = fingerprint_path(voice_id) + ".tmp"
                    torch.save(se.cpu(), tmp)
                    os.replace(tmp, fingerprint_path(voice_id))  # never leave a half-written fingerprint
                    fingerprints.pop(voice_id, None)
                    y0, sr0 = sf.read(wav)
                    f0 = median_f0(y0 if y0.ndim == 1 else y0[:, 0], sr0)
                    if f0:
                        open(f0_path(voice_id), "w").write(f"{f0:.1f}")
                    return self._send(200, b"ok")
                try:
                    target = load_fingerprint(voice_id)
                except FileNotFoundError:
                    return self._send(404, b"this voice has no fingerprint")
                if url.path == "/score":
                    sim = float(torch.nn.functional.cosine_similarity(conv.extract_se([wav]).flatten(), target.flatten(), dim=0))
                    return self._send(200, json.dumps({"similarity": round(sim, 4)}).encode(), "application/json")
                tau = float((parse_qs(url.query).get("tau") or [TAU])[0])
                ckey = (voice_id, tau, os.path.getmtime(fingerprint_path(voice_id)), hashlib.sha1(open(wav, "rb").read()).hexdigest())
                if ckey in converted:
                    return self._send(200, converted[ckey], "audio/wav")
                target_f0 = load_f0(voice_id)
                if PITCH_MATCH and target_f0:
                    y, sr = librosa.load(wav, sr=None)
                    src_f0 = median_f0(y, sr)
                    if src_f0:
                        steps = float(np.clip(12 * np.log2(target_f0 / src_f0), -MAX_SHIFT, MAX_SHIFT))
                        if abs(steps) > 0.3:
                            sf.write(wav, librosa.effects.pitch_shift(y, sr=sr, n_steps=steps), sr, subtype="PCM_16")
                source = conv.extract_se([wav])
                audio = conv.convert(audio_src_path=wav, src_se=source, tgt_se=target, output_path=None, tau=float((parse_qs(url.query).get("tau") or [TAU])[0]), message="")
                audio = librosa.resample(np.asarray(audio, dtype=np.float32), orig_sr=conv.hps.data.sampling_rate, target_sr=OUT_RATE)
                audio = np.clip(audio, -1.0, 1.0)
                buf = io.BytesIO()
                sf.write(buf, audio, OUT_RATE, format="WAV", subtype="PCM_16")
                if len(converted) >= 100: converted.pop(next(iter(converted)))
                converted[ckey] = buf.getvalue()
                return self._send(200, converted[ckey], "audio/wav")
        except Exception as e:  # one bad request must never take the server down
            return self._send(500, str(e)[:200].encode())
        finally:
            try:
                os.remove(wav)
            except OSError:
                pass


if __name__ == "__main__":
    print(f"Voice conversion server on 127.0.0.1:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
