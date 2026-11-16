#!/usr/bin/env bash
# Voice service in DEMO MODE: the AI is a stand-in, never AskG1. Use when AskG1's API is unreachable, and say so.
#   DEMO_AI=llama  a small real model on this Mac (Llama 3.2 3B): answers anything, English and Hindi, less polished than AskG1.
#   DEMO_AI=fixed  fixed price answers only (no model needed).
# The default is llama when its file is fully downloaded, otherwise fixed. Safe to run again: an older copy of this demo is
# stopped first; anything else on the ports is left alone and reported.
set -euo pipefail
cd "$(dirname "$0")/.."

MODEL=.local/models/Llama-3.2-3B-Instruct-Q4_K_M.gguf
MODEL_BYTES=2019377696
LLAMA=.local/llama.cpp/build/bin/llama-server

free_port() { # port, text that identifies OUR process (in its command line or its working folder)
  local pid cmd dir
  for pid in $(lsof -ti :"$1" -sTCP:LISTEN 2>/dev/null || true); do
    cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    dir="$(lsof -p "$pid" -a -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)"
    if [[ "$cmd" == *"$2"* || "$dir" == *"$2"* ]]; then
      echo "Stopping the older copy on port $1 (pid $pid)"; kill "$pid" 2>/dev/null || true
    else
      echo "Port $1 is used by something else (pid $pid): $cmd" >&2
      echo "Stop it, or set PORT for the voice service, then run this again." >&2
      exit 1
    fi
  done
  for _ in 1 2 3 4 5 6 7 8 9 10; do lsof -ti :"$1" -sTCP:LISTEN >/dev/null 2>&1 || return 0; sleep 0.3; done
}

AI="${DEMO_AI:-}"
if [ -z "$AI" ]; then
  if [ -x "$LLAMA" ] && [ -f "$MODEL" ] && [ "$(stat -f%z "$MODEL" 2>/dev/null || stat -c%s "$MODEL")" = "$MODEL_BYTES" ]; then AI=llama; else AI=fixed; fi
fi

if [ "$AI" = llama ]; then free_port 8090 "llama-server"; else free_port 8099 "fake-askg1.mjs"; fi
free_port "${PORT:-4001}" "/apps/voice"

pids=()
trap 'kill "${pids[@]}" 2>/dev/null || true' EXIT INT TERM
echo "=============================================================="
if [ "$AI" = llama ]; then
  [ -f "$MODEL" ] && [ -x "$LLAMA" ] || { echo "Local model not ready (see docs/LOCAL_VOICE_STACK.md)." >&2; exit 1; }
  echo " DEMO MODE: answers come from a small local model (Llama 3.2 3B)."
  echo " It is a stand-in, NOT the real AskG1."
  echo "=============================================================="
  mkdir -p .local/logs
  "$LLAMA" -m "$MODEL" --host 127.0.0.1 --port 8090 -c 4096 -ngl 99 > .local/logs/llama.log 2>&1 &
  pids+=($!)
  echo "Loading the model..."
  for _ in $(seq 1 60); do curl -s -m 2 -o /dev/null http://127.0.0.1:8090/health && break; sleep 1; done
  export ASKG1_BASE_URL=http://127.0.0.1:8090
else
  echo " DEMO MODE: the AI answers are fixed text (plan prices only)."
  echo " It is a stand-in, NOT the real AskG1."
  echo "=============================================================="
  PORT=8099 node scripts/fake-askg1.mjs & pids+=($!)
  sleep 1
  export ASKG1_BASE_URL=http://127.0.0.1:8099
fi
pnpm --filter @voiceai/voice exec tsx src/index.ts
