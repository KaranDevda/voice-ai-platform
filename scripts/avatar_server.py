"""
Talking-avatar server: MuseTalk 1.5 turns the AI's voice into lip-synced video of a real photo, frame by frame.
Run with the MuseTalk Python (3.10 environment), from the MuseTalk folder:  python avatar_server.py --port 8083 --secret TOKEN

  POST /{secret}/avatar            body = a photo (jpg/png)  ->  {"avatar_id", "w", "h", "ms"}   (face found, mask and latents prepared once)
  GET  /{secret}/stream/{avatar}   WebSocket
       client -> server  binary: uint32 segment id | uint32 sample rate | PCM16 mono audio of one stretch of the AI's speech
       server -> client  binary: uint32 segment id | uint32 frame index | JPEG of the changing face rectangle ("patch" in the avatar answer)
                         text:   {"type":"done","seg":n,"frames":F,"fps":20,"audio_ms":..,"render_ms":..}
  GET  /health
"""
import argparse, asyncio, io, json, os, struct, sys, threading, time, uuid
from concurrent.futures import ThreadPoolExecutor

os.environ["MPLBACKEND"] = "Agg"  # Colab's inline plotting backend is not valid in this process (xtcocotools imports matplotlib)
import cv2
import librosa
import numpy as np
import torch
from aiohttp import web
from transformers import WhisperModel

sys.path.insert(0, os.getcwd())
from musetalk.utils.audio_processor import AudioProcessor
from musetalk.utils.blending import get_image_blending, get_image_prepare_material
from musetalk.utils.face_parsing import FaceParsing
from musetalk.utils.preprocessing import get_landmark_and_bbox
from musetalk.utils.utils import datagen, load_all_model

FPS = int(os.environ.get("AVATAR_FPS", "20"))   # 20 fps: about 1.6x faster than real time on a T4 (25 fps had no headroom)
BATCH = int(os.environ.get("AVATAR_BATCH", "8"))  # small batches: the first frame is ready after about 0.45 s
MAX_SIDE = 512            # photos are shrunk to this: faster blending and smaller frames
EXTRA_MARGIN = 10         # MuseTalk 1.5 default
device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
gpu_lock = threading.Lock()
pool = ThreadPoolExecutor(3)  # blending and JPEG encoding overlap with the next GPU batch

print("loading MuseTalk models...", flush=True)
vae, unet, pe = load_all_model(unet_model_path="./models/musetalkV15/unet.pth", vae_type="sd-vae", unet_config="./models/musetalkV15/musetalk.json", device=device)
timesteps = torch.tensor([0], device=device)
pe = pe.half().to(device)
vae.vae = vae.vae.half().to(device)
unet.model = unet.model.half().to(device)
audio_processor = AudioProcessor(feature_extractor_path="./models/whisper")
dtype = unet.model.dtype
whisper = WhisperModel.from_pretrained("./models/whisper").to(device=device, dtype=dtype).eval()
whisper.requires_grad_(False)
fp = FaceParsing(left_cheek_width=90, right_cheek_width=90)
avatars: dict = {}

# The full Stable Diffusion decoder costs about 80 ms per frame on a T4, so video can never reach 25 fps. TAESD is the standard small decoder for the same
# latent space: about 6 ms per frame and within 32 dB (nearly identical) of the full one. AVATAR_DECODER=full goes back to the big one.
tiny = None
if os.environ.get("AVATAR_DECODER", "tiny") == "tiny":
    from diffusers import AutoencoderTiny
    tiny = AutoencoderTiny.from_pretrained("madebyollin/taesd", torch_dtype=torch.float16).to(device).eval()


def decode(pred):
    if tiny is None:
        return vae.decode_latents(pred.to(device=device, dtype=vae.vae.dtype))
    img = (tiny.decode(pred.to(torch.float16)).sample / 2 + 0.5).clamp(0, 1)
    return (img.float().cpu().permute(0, 2, 3, 1).numpy() * 255).round().astype("uint8")[..., ::-1]


def prepare_avatar(data: bytes) -> dict:
    """Finds the face in one photo and prepares everything the video needs, once."""
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("This file is not a readable photo.")
    h, w = img.shape[:2]
    k = min(1.0, MAX_SIDE / max(h, w))
    if k < 1.0:
        img = cv2.resize(img, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA)
    path = f"/tmp/avatar_{uuid.uuid4().hex}.png"
    cv2.imwrite(path, img)
    try:
        coords, frames = get_landmark_and_bbox([path], 0)
    finally:
        os.remove(path)
    frame, bbox = frames[0], coords[0]
    if tuple(bbox) == (0.0, 0.0, 0.0, 0.0):
        raise ValueError("No face was found in this photo. Use a clear, front-facing photo with the whole face visible.")
    x1, y1, x2, y2 = bbox
    y2 = min(y2 + EXTRA_MARGIN, frame.shape[0])
    crop = cv2.resize(frame[y1:y2, x1:x2], (256, 256), interpolation=cv2.INTER_LANCZOS4)
    with gpu_lock, torch.no_grad():
        latents = vae.get_latents_for_unet(crop)
    mask, crop_box = get_image_prepare_material(frame, [x1, y1, x2, y2], fp=fp, mode="jaw")
    # Only the lower face changes from frame to frame. Send just that rectangle (the browser draws it over the photo it already has):
    # about a quarter of the data of a whole frame, which matters through a tunnel.
    ys, xs = np.nonzero(np.asarray(mask) > 0)
    H, W = frame.shape[:2]
    cb = [int(v) for v in crop_box]       # NumPy integers cannot be written as JSON
    px0, py0 = max(0, cb[0] + int(xs.min()) - 4), max(0, cb[1] + int(ys.min()) - 4)
    px1, py1 = min(W, cb[0] + int(xs.max()) + 5), min(H, cb[1] + int(ys.max()) + 5)
    return {"frame": frame, "bbox": [x1, y1, x2, y2], "latents": latents, "mask": mask, "crop_box": cb, "patch": [px0, py0, px1, py1]}


def blend_jpeg(av: dict, res_frame) -> bytes:
    x1, y1, x2, y2 = av["bbox"]
    res = cv2.resize(res_frame.astype(np.uint8), (x2 - x1, y2 - y1))
    out = get_image_blending(av["frame"].copy(), res, av["bbox"], av["mask"], av["crop_box"])
    px0, py0, px1, py1 = av["patch"]
    ok, buf = cv2.imencode(".jpg", out[py0:py1, px0:px1], [cv2.IMWRITE_JPEG_QUALITY, 85])
    return buf.tobytes()


def render(av: dict, pcm: bytes, rate: int, emit, fps: int = FPS) -> dict:
    """Turns one stretch of speech into video frames; emit(index, jpeg) is called for each as soon as it is ready."""
    t0 = time.time()
    audio = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0
    if rate != 16000:
        audio = librosa.resample(audio, orig_sr=rate, target_sr=16000)
    if len(audio) < 16000 * 0.12:
        return {"frames": 0, "audio_ms": int(len(audio) / 16), "render_ms": 0}
    seg = 30 * 16000
    feats = [audio_processor.feature_extractor(audio[i:i + seg], return_tensors="pt", sampling_rate=16000).input_features.to(dtype=dtype) for i in range(0, len(audio), seg)]
    futures, n = [], 0
    with gpu_lock, torch.no_grad():
        chunks = audio_processor.get_whisper_chunk(feats, device, dtype, whisper, len(audio), fps=fps, audio_padding_length_left=2, audio_padding_length_right=2)
        n = len(chunks)
        sent = 0
        for wb, lb in datagen(chunks, [av["latents"]], BATCH):
            pred = unet.model(lb.to(device=device, dtype=unet.model.dtype), timesteps, encoder_hidden_states=pe(wb.to(device))).sample
            recon = decode(pred)
            futures += [pool.submit(blend_jpeg, av, r) for r in recon]
            while sent < len(futures) and futures[sent].done():
                emit(sent, futures[sent].result()); sent += 1
    for i in range(sent, len(futures)):
        emit(i, futures[i].result())
    return {"frames": n, "audio_ms": int(len(audio) / 16), "render_ms": int((time.time() - t0) * 1000)}


# ---------------------------------------------------------------------------------------------------- web server
@web.middleware
async def cors(request, handler):
    """The Live page runs on another address, so the browser needs permission to talk to this server."""
    resp = web.Response(status=204) if request.method == "OPTIONS" else await handler(request)
    if not isinstance(resp, web.WebSocketResponse):
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "*"
    return resp


def make_app(secret: str) -> web.Application:
    app = web.Application(client_max_size=32 * 1024 * 1024, middlewares=[cors])

    def ok(req):
        return req.match_info["secret"] == secret

    async def health(_):
        return web.json_response({"ok": True, "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None})

    async def make_avatar(req):
        if not ok(req): return web.Response(status=401, text="bad token")
        t = time.time()
        try:
            av = await asyncio.get_running_loop().run_in_executor(None, prepare_avatar, await req.read())
        except ValueError as e:
            return web.json_response({"error": str(e)}, status=422)
        aid = uuid.uuid4().hex[:12]
        avatars[aid] = av
        while len(avatars) > 4:               # old photos from earlier visits are dropped
            avatars.pop(next(iter(avatars)))
        h, w = av["frame"].shape[:2]
        return web.json_response({"avatar_id": aid, "w": w, "h": h, "ms": int((time.time() - t) * 1000), "fps": FPS,
                                  "patch": {"x": av["patch"][0], "y": av["patch"][1], "w": av["patch"][2] - av["patch"][0], "h": av["patch"][3] - av["patch"][1]}})

    async def stream(req):
        if not ok(req): return web.Response(status=401, text="bad token")
        av = avatars.get(req.match_info["avatar"])
        if av is None: return web.Response(status=404, text="unknown avatar")
        ws = web.WebSocketResponse(max_msg_size=32 * 1024 * 1024)
        await ws.prepare(req)
        loop = asyncio.get_running_loop()
        jobs: asyncio.Queue = asyncio.Queue()

        async def worker():
            while True:
                seg, rate, pcm = await jobs.get()
                while jobs.qsize() > 2:       # far behind: skip the oldest stretch rather than fall further back
                    await ws.send_str(json.dumps({"type": "dropped", "seg": seg}))
                    seg, rate, pcm = await jobs.get()
                def emit(i, jpeg):
                    asyncio.run_coroutine_threadsafe(ws.send_bytes(struct.pack("<II", seg, i) + jpeg), loop).result()
                try:
                    info = await loop.run_in_executor(None, render, av, pcm, rate, emit)
                    await ws.send_str(json.dumps({"type": "done", "seg": seg, "fps": FPS, **info}))
                except Exception as e:  # keep the call alive; the page just shows the still photo for this stretch
                    if ws.closed: return
                    await ws.send_str(json.dumps({"type": "error", "seg": seg, "message": str(e)}))

        task = asyncio.create_task(worker())
        try:
            async for m in ws:
                if m.type == web.WSMsgType.BINARY and len(m.data) > 8:
                    seg, rate = struct.unpack("<II", m.data[:8])
                    await jobs.put((seg, rate, m.data[8:]))
        finally:
            task.cancel()
        return ws

    async def speedtest(req):
        """GET /{secret}/speedtest?bytes=N: N random bytes, to measure how fast the link carries video back to the browser."""
        if not ok(req): return web.Response(status=401, text="bad token")
        n = min(20_000_000, int(req.query.get("bytes", "2000000")))
        return web.Response(body=os.urandom(n), content_type="application/octet-stream")

    app.router.add_get("/health", health)
    app.router.add_get("/{secret}/speedtest", speedtest)
    app.router.add_post("/{secret}/avatar", make_avatar)
    app.router.add_get("/{secret}/stream/{avatar}", stream)
    return app


def bench():
    """Speed check: renders 6 s of speech and reports frames per second."""
    img = open("assets/demo/man/man.png", "rb").read()
    t = time.time(); av = prepare_avatar(img); print(f"prepare avatar: {time.time() - t:.2f}s, frame {av['frame'].shape[:2]}", flush=True)
    audio, _ = librosa.load("data/audio/eng.wav", sr=24000, duration=6.0)
    pcm = (audio * 32767).astype("<i2").tobytes()
    for label, length in (("warm-up 2 s", 2), ("3 s", 3), ("6 s", 6)):
        piece = pcm[: 24000 * 2 * length]; got = []; t0 = time.time(); first = [None]
        def emit(i, j):
            if first[0] is None: first[0] = time.time() - t0
            got.append(len(j))
        info = render(av, piece, 24000, emit)
        el = time.time() - t0
        print(f"{label}: {info['frames']} frames in {el:.2f}s = {info['frames'] / el:.1f} fps (needs {FPS}); first frame after {first[0]:.2f}s; jpeg ~{sum(got) // max(1, len(got)) // 1024} KB", flush=True)


def warm_up():
    """The first render after start-up is slow (the GPU picks its fastest kernels): do it now, on a sample face, so the first real answer is quick."""
    try:
        av = prepare_avatar(open("assets/demo/man/man.png", "rb").read())
        audio, _ = librosa.load("data/audio/eng.wav", sr=24000, duration=2.0)
        render(av, (audio * 32767).astype("<i2").tobytes(), 24000, lambda i, j: None)
        print("warm-up done", flush=True)
    except Exception as e:
        print("warm-up skipped:", e, flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8083)
    ap.add_argument("--secret", default="dev")
    ap.add_argument("--bench", action="store_true")
    a = ap.parse_args()
    if a.bench:
        bench()
    else:
        warm_up()
        print("serving", flush=True)
        web.run_app(make_app(a.secret), host="127.0.0.1", port=a.port, print=None)
