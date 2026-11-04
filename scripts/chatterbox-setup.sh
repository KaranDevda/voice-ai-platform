#!/usr/bin/env bash
# One-time setup of the Chatterbox voice server on the machine that has the GPU (Linux or Windows WSL with NVIDIA, or a Mac).
# Needs Python 3.11 and about 6 GB of disk. Then start it with the command printed at the end.
set -euo pipefail
cd "$(dirname "$0")/.."
PY="${PYTHON:-python3.11}"
$PY -m venv .local/chatterbox-venv
V=.local/chatterbox-venv/bin
$V/pip install --upgrade pip
if command -v nvidia-smi >/dev/null 2>&1; then $V/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121; else $V/pip install torch torchaudio; fi
$V/pip install chatterbox-tts==0.1.7
$V/python - <<'PY'
import torch
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
dev = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"
print("device:", dev)
ChatterboxMultilingualTTS.from_pretrained(device=dev)  # downloads the model once
print("model ready")
PY
TOKEN="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
cat <<MSG

Done. Start the server (keep it on a private network such as Tailscale, never on the open internet):

  CHATTERBOX_HOST=0.0.0.0 CHATTERBOX_TOKEN=$TOKEN .local/chatterbox-venv/bin/python scripts/chatterbox-server.py

Then on the machine that runs the web app and voice service, add to apps/web/.env.local and apps/voice/.env.local:

  CHATTERBOX_URL=http://<this machine's address>:8771
  CHATTERBOX_TOKEN=$TOKEN
MSG
