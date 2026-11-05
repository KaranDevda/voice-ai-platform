# Hindi / Hinglish speech-to-text comparison, 3 Nov 2026

Run with `pnpm --filter @voiceai/voice exec tsx src/stt-compare.ts` (10 sentences with names, numbers and a phone number, spoken by the local Kokoro Hindi voice).

| Provider | Character error rate | Time p50 | Time p95 |
|---|---|---|---|
| Sarvam saarika:v2.5 (cloud) | **1.0%** | **0.26 s** | 0.58 s |
| Whisper small (local, our servers) | 19.0% | 0.97 s | 1.07 s |
| Deepgram nova-3 (cloud) | 24.1% | 1.01 s | 2.52 s |

How to read it:
- Sarvam writes Hindi in Devanagari, including English loan words ("बिज़नेस प्लान"), which matches how we write replies.
- Deepgram and Whisper often write English loan words in Latin letters ("business plan", "call record"). The score counts that as an error, though the meaning is right; the real accuracy gap is smaller than the table shows. Whisper also turned a spoken phone number into "987654321".
- The speech is synthetic (cleaner than a phone line) and 10 sentences is a small set. Treat this as a first screening, and re-run on 20 recorded real calls before choosing.
- Sarvam and Deepgram send caller audio to their clouds: not for private-AI clients. Local Whisper is the self-hosted option.
- Turn on: `STT_HINDI=sarvam` (Hindi and mixed calls) or `STT_PROVIDER=sarvam` (all calls) in apps/voice/.env.local, then restart the voice service. Not switched on yet.

## 5 November 2026: can the local Hindi setting be made faster? (open source only)

Same model (large-v3-turbo, q5_0) with different decoding settings, on the 10 spoken Hindi sentences above (Kokoro voice, so cleaner than a phone line), on the M4:

| Setting | Character error rate | Median time per phrase |
|---|---|---|
| **Current: `-ac 1000 -bs 2 -bo 2`** | **12.0%** | **0.94 s** |
| `-ac 768 -bs 1 -bo 1` (greedy, shorter context) | 14.7% | 0.67 s |
| `-ac 1000 -bs 1 -bo 1` (greedy) | 14.9% | 0.88 s |
| `-ac 640 -bs 2 -bo 2` | 17.2% | 0.64 s |

Every faster setting saves at most about 0.3 s and loses 3 to 5 points of accuracy, on a language where names and numbers are already the weak spot. The current setting stays. The rest of the 1.9 s Hindi delay is the 0.4 s of silence waited for (`ENDPOINTING_MS`) and the model decoding the whole sentence only after it ends. Getting Hindi under 1 s needs a different approach (decoding while the caller speaks, or a faster Hindi model), not a flag.
