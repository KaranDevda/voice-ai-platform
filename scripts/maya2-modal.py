"""
Maya 2 voice server on Modal (a rented GPU, no queue, no Colab/Kaggle session to keep open).
One-time:   pip install modal && modal setup          (opens a browser to log in)
Deploy:     MAYA2_TOKEN=$(openssl rand -urlsafe 2>/dev/null || python3 -c "import secrets;print(secrets.token_urlsafe(32))") modal deploy scripts/maya2-modal.py
It prints a link ending in .modal.run: that is MAYA2_URL. MAYA2_TOKEN is the value you set above.
The GPU container starts when the first request arrives (about 1-2 minutes the first time, models are cached afterwards) and stops by itself after 10 idle minutes, so it only costs money while in use.
"""
import os
import modal

GPU = os.environ.get("MAYA2_GPU", "L4")
app = modal.App("maya2-voice")
cache = modal.Volume.from_name("maya2-hf-cache", create_if_missing=True)
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git")
    .pip_install("maya3[server] @ git+https://github.com/MayaResearch/maya2-native", "aiohttp")
    .pip_install("torchvision==0.23.0", "torchaudio==2.8.0", index_url="https://download.pytorch.org/whl/cu126")
    .env({"HF_HOME": "/cache/hf"})
)


@app.function(image=image, gpu=GPU, volumes={"/cache": cache}, secrets=[modal.Secret.from_dict({"MAYA2_TOKEN": os.environ.get("MAYA2_TOKEN", "")})],
              scaledown_window=600, timeout=3600, max_containers=1)
@modal.concurrent(max_inputs=4)
@modal.web_server(port=8081, startup_timeout=900)
def serve():
    import subprocess, sys, threading, time, urllib.request, asyncio, json
    from aiohttp import web, ClientSession
    TOKEN = os.environ["MAYA2_TOKEN"]
    assert TOKEN, "set MAYA2_TOKEN when deploying"
    subprocess.Popen([sys.executable, "-m", "maya3.server", "--ckpt", "maya-research/maya2-native", "--host", "127.0.0.1", "--port", "8090", "--max-seats", "2"])
    for _ in range(300):
        try:
            if urllib.request.urlopen("http://127.0.0.1:8090/health", timeout=2).status == 200: break
        except Exception: time.sleep(3)
    cache.commit()
    async def tempo_pcm(r, resp, speed):
        p = await asyncio.create_subprocess_exec('ffmpeg', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0', '-af', f'atempo={speed:.3f}', '-f', 's16le', 'pipe:1',
                                                 stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
        async def feed():
            try:
                async for c in r.content.iter_any():
                    p.stdin.write(c); await p.stdin.drain()
            finally:
                p.stdin.close()
        t = asyncio.create_task(feed())
        while True:
            d = await p.stdout.read(4800)
            if not d: break
            await resp.write(d)
        await t; await p.wait()
    async def gate(request):
        if request.headers.get('authorization') != f'Bearer {TOKEN}':
            return web.Response(status=401, text='bad token')
        body = await request.read()
        speech = request.method == 'POST' and request.path.startswith('/v1/audio/speech')
        speed, fmt = 1.0, 'wav'
        if speech:
            try:
                j = json.loads(body); speed = float(j.pop('speed', 1.0) or 1.0); fmt = j.get('response_format', 'wav'); body = json.dumps(j).encode()
            except Exception: pass
        speed = min(1.6, max(0.6, speed))
        fast = speech and abs(speed - 1.0) > 0.01
        async with ClientSession() as s:
            async with s.request(request.method, f'http://127.0.0.1:8090{request.path_qs}', data=body or None,
                                 headers={k: v for k, v in request.headers.items() if k.lower() in ('content-type',)}) as r:
                hdrs = {k: v for k, v in r.headers.items() if k.lower() in ('content-type', 'x-sample-rate', 'x-encoding')}
                if fast and r.status == 200 and fmt == 'wav':
                    raw = await r.read()
                    p = await asyncio.create_subprocess_exec('ffmpeg', '-loglevel', 'error', '-i', 'pipe:0', '-af', f'atempo={speed:.3f}', '-f', 'wav', 'pipe:1', stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
                    out, _ = await p.communicate(raw)
                    return web.Response(status=200, body=out, headers=hdrs)
                resp = web.StreamResponse(status=r.status, headers=hdrs)
                await resp.prepare(request)
                if fast and r.status == 200 and fmt == 'pcm':
                    await tempo_pcm(r, resp, speed)
                else:
                    async for chunk in r.content.iter_any(): await resp.write(chunk)
                await resp.write_eof(); return resp
    async def start():
        app_ = web.Application(client_max_size=64 * 1024 * 1024)
        app_.router.add_route("*", "/{tail:.*}", gate)
        runner = web.AppRunner(app_); await runner.setup(); await web.TCPSite(runner, "0.0.0.0", 8081).start()
    def run():
        loop = asyncio.new_event_loop(); loop.run_until_complete(start()); loop.run_forever()
    threading.Thread(target=run, daemon=True).start()
