#!/usr/bin/env bash
# Keeps the voice service (port 4001) running. It reloads when its code changes (tsx watch), and if it stops answering for 15 seconds
# (a crash, a broken edit, a killed process) the whole thing is restarted. tsx watch alone does not: after a crash it just waits for
# the next file change. Started by pnpm dev:stack; can also be run alone with pnpm dev:voice. Needs no particular starting folder.
cd "$(dirname "$0")/../apps/voice" || exit 1
PORT_NOW="${PORT:-4001}"
child=""
stop_child() { [ -n "$child" ] && { pkill -P "$child" 2>/dev/null; kill "$child" 2>/dev/null; }; child=""; }
trap 'stop_child; exit 0' INT TERM
while true; do
  pnpm exec tsx watch src/index.ts &
  child=$!
  sleep 12  # time to start
  fails=0
  while kill -0 "$child" 2>/dev/null; do
    if curl -s -m 3 "http://127.0.0.1:$PORT_NOW/healthz" >/dev/null; then fails=0; else fails=$((fails + 1)); fi
    [ "$fails" -ge 3 ] && break
    sleep 5
  done
  echo "[$(date +%T)] the voice service stopped answering; restarting" >&2
  stop_child
  # make sure nothing of ours still holds the port
  for pid in $(lsof -ti :"$PORT_NOW" -sTCP:LISTEN 2>/dev/null); do ps -o command= -p "$pid" | grep -q "src/index.ts" && kill "$pid" 2>/dev/null; done
  sleep 2
done
