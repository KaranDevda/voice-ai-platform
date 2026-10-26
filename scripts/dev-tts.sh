#!/usr/bin/env bash
# Starts the free self-hosted voice server (Kyutai Pocket TTS, MIT) for local development. See docs/POCKET_TTS.md.
set -euo pipefail
cd "$(dirname "$0")/.."
BIN=.local/pocket-tts/pocket-tts
PORT="${POCKET_TTS_PORT:-8765}"
[ -x "$BIN" ] || { echo "Missing $BIN. See docs/POCKET_TTS.md for the one-time download."; exit 1; }
# Voice cloning needs a Hugging Face token (read access, after accepting the model terms). Read from the gitignored env file.
if [ -z "${HF_TOKEN:-}" ] && [ -f apps/web/.env.local ]; then
  HF_TOKEN="$(grep -E '^HF_TOKEN=' apps/web/.env.local | cut -d= -f2- || true)"; export HF_TOKEN
fi
[ -n "${HF_TOKEN:-}" ] || echo "Note: HF_TOKEN not set, so only built-in voices will work (no cloning)."
# Bound to localhost: the server must never be reachable from outside the machine or private network.
exec "$BIN" serve --host 127.0.0.1 --port "$PORT"
