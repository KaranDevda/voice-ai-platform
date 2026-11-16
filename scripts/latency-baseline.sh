#!/usr/bin/env bash
# Baseline for the latency work: 20 English and 20 Hindi/Hinglish scripted calls, one at a time (no load), every stage logged.
# Usage: scripts/latency-baseline.sh <label>     e.g. "baseline" or "after-endpointing"   -> docs/baseline/<date>-<label>-{en,hi}.json + summary
# Needs the voice service and the local stack running (pnpm dev:voice, pnpm dev:stack) and Tailscale up for AskG1.
set -euo pipefail
cd "$(dirname "$0")/.."
LABEL="${1:-baseline}"; DATE="$(date +%F)"; OUT="docs/baseline/$DATE-$LABEL"
V="pnpm --filter @voiceai/voice"
$V warm >/dev/null 2>&1 || true; $V warm >/dev/null 2>&1 || true   # AskG1 is slow on a prompt it has not read recently: never measure cold
EN_Q="Hello, I wanted to ask about your plans.|How much does the business plan cost?|Do you record the calls?|Which languages do you support?|Can I get a demo this week?|My name is Rohan Mehta and my number is 98765 43210.|Is the price 4,999 rupees per month?|I'm comparing the Business and Enterprise plans: what are their monthly prices, user limits, recording retention, and annual payment discount?"
HI_Q="नमस्ते, मुझे आपके प्लान के बारे में जानना है।|बिज़नेस प्लान की कीमत कितनी है?|क्या आप कॉल रिकॉर्ड करते हैं?|आप कौन सी भाषाएँ सपोर्ट करते हैं?|क्या इस हफ़्ते डेमो मिल सकता है?|मेरा नाम रोहन मेहता है और मेरा नंबर 98765 43210 है।|क्या कीमत चार हज़ार नौ सौ निन्यानवे रुपये प्रति माह है?|Business plan ka monthly price kya hai aur usme kitne users hain?|मैं Business और Enterprise plans compare कर रहा हूँ: उनकी monthly pricing, users की limit, recording retention और yearly payment discount क्या है?"
[ -n "${SKIP_EN:-}" ] || $V load-test -- --calls 20 --concurrency 1 --turns 1 --language en --voice pocket:alba --speaker am_michael --questions "$EN_Q" --json "$PWD/$OUT-en.json" | tee "$OUT-en.txt" || true
$V load-test -- --calls 20 --concurrency 1 --turns 1 --language en-hi --voice pocket:alba --speaker hf_alpha --questions "$HI_Q" --json "$PWD/$OUT-hi.json" | tee "$OUT-hi.txt" || true
python3 scripts/latency-summary.py "$OUT-en.json" "$OUT-hi.json"
