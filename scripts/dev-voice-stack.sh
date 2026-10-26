#!/usr/bin/env bash
# Starts the free, local voice servers together: speech-to-text (Whisper), English voice, Hindi voice, voice conversion,
# and the backup AI (Llama 3.2, used only when AskG1 cannot answer). One terminal, Ctrl+C stops them all. Setup and downloads: docs/LOCAL_VOICE_STACK.md.
set -euo pipefail
cd "$(dirname "$0")/.."
LOCAL=.local
WHISPER="$LOCAL/whisper.cpp/build/bin/whisper-server"
MODEL="$LOCAL/models/ggml-large-v3-turbo-q5_0.bin"
TTS="$LOCAL/pocket-tts/pocket-tts"
HI_CONFIG="${POCKET_TTS_HI_CONFIG:-}"
[ -f apps/web/.env.local ] && [ -z "$HI_CONFIG" ] && HI_CONFIG="$(grep -E '^POCKET_TTS_HI_CONFIG=' apps/web/.env.local | cut -d= -f2- | tr -d '"')"
for f in "$WHISPER" "$MODEL" "$TTS"; do [ -e "$f" ] || { echo "Missing $f. See docs/LOCAL_VOICE_STACK.md"; exit 1; }; done
[ -z "${HF_TOKEN:-}" ] && [ -f apps/web/.env.local ] && { HF_TOKEN="$(grep -E '^HF_TOKEN=' apps/web/.env.local | cut -d= -f2- || true)"; export HF_TOKEN; }
[ -n "${HF_TOKEN:-}" ] || echo "Note: HF_TOKEN not set, so English cloning will not work."
free_port() { # port, text that identifies OUR program in its command line (a miss is fine: another pattern may match)
  local pid cmd
  for pid in $(lsof -ti :"$1" -sTCP:LISTEN 2>/dev/null || true); do
    cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    if [[ "$cmd" == *"$2"* ]]; then echo "Stopping the older copy on port $1 (pid $pid)"; kill "$pid" 2>/dev/null || true
    elif [[ "$cmd" == *"pocket-tts"* || "$cmd" == *"kokoro-server"* || "$cmd" == *"whisper-server"* ]]; then :  # another of our servers: the next call handles it
    else echo "Port $1 is used by something else (pid $pid): $cmd" >&2; exit 1; fi
  done
  for _ in 1 2 3 4 5 6 7 8 9 10; do lsof -ti :"$1" -sTCP:LISTEN >/dev/null 2>&1 || return 0; sleep 0.3; done
}
free_port 8090 "llama-server"; free_port 8767 "whisper-server"; free_port 8769 "voice-convert-server"; free_port 8765 "pocket-tts"; free_port 8768 "pocket-tts"; free_port 8768 "kokoro-server"
mkdir -p "$LOCAL/logs"
pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT INT TERM
# -ac 640 shortens the audio window Whisper looks at (about 2x faster on short utterances); -bs 1 -bo 1 -nf keep decoding quick.
"$WHISPER" -m "$MODEL" --host 127.0.0.1 --port 8767 -t 4 -nt -ac 640 -bs 1 -bo 1 -nf > "$LOCAL/logs/whisper.log" 2>&1 & pids+=($!)
"$TTS" serve --host 127.0.0.1 --port 8765 > "$LOCAL/logs/voice-en.log" 2>&1 & pids+=($!)
KOKORO_PY="$LOCAL/kokoro-venv/bin/python"
if [ -x "$KOKORO_PY" ] && [ -f "$LOCAL/models/kokoro-v1.0.onnx" ]; then
  # Hindi voice: Kokoro (reliable, fixed male and female voices). Preferred over the Pocket Hindi model.
  "$KOKORO_PY" scripts/kokoro-server.py > "$LOCAL/logs/kokoro.log" 2>&1 & pids+=($!)
elif [ -n "$HI_CONFIG" ]; then "$TTS" serve --host 127.0.0.1 --port 8768 --config "$HI_CONFIG" > "$LOCAL/logs/voice-hi.log" 2>&1 & pids+=($!); else echo "Note: POCKET_TTS_HI_CONFIG not set, so no Hindi voice."; fi
# Voice conversion: changes Hindi and Hinglish into the cloned person's own voice (OpenVoice). Optional: without it Hindi uses the built-in voice.
OV_PY="$LOCAL/ov-venv/bin/python"
if [ -x "$OV_PY" ] && [ -f "$LOCAL/models/openvoice-v2/converter/checkpoint.pth" ]; then
  "$OV_PY" scripts/voice-convert-server.py > "$LOCAL/logs/voice-convert.log" 2>&1 & pids+=($!)
else echo "Note: voice conversion is not installed, so Hindi uses the built-in voice. See docs/LOCAL_VOICE_STACK.md."; fi
# Backup AI: answers when AskG1 is unreachable or slow (VPN off, server down). Needs the complete model file (see docs/LOCAL_VOICE_STACK.md).
LLAMA="$LOCAL/llama.cpp/build/bin/llama-server"; LLAMA_MODEL="$LOCAL/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf"
if [ -x "$LLAMA" ] && [ -f "$LLAMA_MODEL" ] && [ "$(stat -f%z "$LLAMA_MODEL" 2>/dev/null || stat -c%s "$LLAMA_MODEL")" = "2019377696" ]; then
  "$LLAMA" -m "$LLAMA_MODEL" --host 127.0.0.1 --port 8090 -c 4096 -ngl 99 > "$LOCAL/logs/llama.log" 2>&1 & pids+=($!)
else echo "Note: the backup AI model is not installed, so nothing answers when AskG1 is down. See docs/LOCAL_VOICE_STACK.md."; fi
echo "Local voice stack running: speech-to-text :8767, English voice :8765, Hindi voice :8768, voice conversion :8769, backup AI :8090. Logs in $LOCAL/logs. Ctrl+C to stop."
wait
