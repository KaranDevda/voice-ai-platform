#!/usr/bin/env bash
# Morning helper: after the Colab notebook finishes, copy the lines it printed (MAYA2_URL=..., MAYA2_TOKEN=..., INDIC_STT_URL=...), then run
#   bash scripts/set-links.sh
# It reads your clipboard, writes the links into apps/web/.env.local and apps/voice/.env.local, makes sure local Whisper is running
# (used to write down each cloned voice's reference clip) and restarts the web app and the voice service.
set -euo pipefail
cd "$(dirname "$0")/.."
clip="$(pbpaste)"
get() { printf '%s\n' "$clip" | grep -E "^$1=" | tail -1 | cut -d= -f2- | tr -d '[:space:]'; }
MAYA2_URL="$(get MAYA2_URL)"; MAYA2_TOKEN="$(get MAYA2_TOKEN)"; INDIC_STT_URL="$(get INDIC_STT_URL)"; AVATAR_URL="$(get AVATAR_URL)"
[ -n "$MAYA2_URL" ] && [ -n "$MAYA2_TOKEN" ] || { echo "No MAYA2_URL / MAYA2_TOKEN in the clipboard. Copy the lines the notebook printed, then run this again."; exit 1; }
setenv() { # file key value
  if grep -q "^$2=" "$1"; then sed -i '' "s#^$2=.*#$2=$3#" "$1"; else printf '%s=%s\n' "$2" "$3" >> "$1"; fi
}
for f in apps/web/.env.local apps/voice/.env.local; do
  setenv "$f" MAYA2_URL "$MAYA2_URL"; setenv "$f" MAYA2_TOKEN "$MAYA2_TOKEN"
done
[ -n "$INDIC_STT_URL" ] && setenv apps/voice/.env.local INDIC_STT_URL "$INDIC_STT_URL"
grep -q "^WHISPER_URL=" apps/web/.env.local || echo "WHISPER_URL=http://127.0.0.1:8767" >> apps/web/.env.local
echo "links written: MAYA2 ok${INDIC_STT_URL:+, Hindi speech-to-text ok}"
mkdir -p .local/logs
if ! lsof -ti :8767 -sTCP:LISTEN >/dev/null 2>&1; then
  DYLD_LIBRARY_PATH="$PWD/.local/whisper.cpp/build/bin" nohup .local/whisper.cpp/build/bin/whisper-server -m .local/models/ggml-large-v3-turbo-q5_0.bin --host 127.0.0.1 --port 8767 -t 8 -nt -ac 1000 -bs 2 -bo 2 > .local/logs/whisper.log 2>&1 &
  echo "local Whisper started"
fi
for port in 3001 4001; do kill $(lsof -ti :$port -sTCP:LISTEN) 2>/dev/null || true; done
sleep 2
(cd apps/voice && nohup node --import tsx src/index.ts > ../../.local/logs/voice.log 2>&1 &)
(cd apps/web && nohup npx next dev --turbopack -p 3001 > ../../.local/logs/web.log 2>&1 &)
sleep 10
curl -s -o /dev/null -w "web app: HTTP %{http_code}\n" http://localhost:3001/login || true
lsof -ti :4001 -sTCP:LISTEN >/dev/null && echo "voice service: running" || echo "voice service: NOT running (see .local/logs/voice.log)"
[ -n "$AVATAR_URL" ] && echo "Avatar link (paste it into the Avatar card on the Live page): $AVATAR_URL"
echo "Open http://localhost:3001/live"
