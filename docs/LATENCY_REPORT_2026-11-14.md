# Voice pipeline baseline and focused changes — 14 November 2026

## What changed

- The load-test JSON now records the requested question, text sent to the synthetic speaker, recognized transcript, answer text, and timing stages. Transcript and answer fields are captured after the turn completes.
- The recurring baseline questions now include a long plan comparison, Hindi script, and Latin-script Hinglish. The Hindi speaker input goes through the same Hinglish-to-Devanagari conversion used by the product voice path.
- Local Whisper kept its 650 ms English and 400 ms Hindi/mixed endpoint defaults. Unfinished transcript endings, including “plan/plans”, get a 350 ms continuation window. If new speech starts during that window, the timer is cancelled and the next final transcript is joined before answering.
- Mixed Devanagari/Roman Hinglish now transliterates known Roman Hindi words too. For example, “Business plan ka monthly price kya hai aur usme kitne users hain?” is prepared for the Hindi speaker as “बिज़नेस प्लान का मंथली प्राइस क्या है और उसमें कितने यूज़र्स हैं?”
- The latency summary now reports the SOP first-audio gate (p50 ≤1.0 s, p95 ≤1.5 s) separately from the actual-answer p50 <1.0 s target.

## Measurements

These local WebSocket runs used synthetic speech and a fixed-response AskG1 stand-in. They did not use the company knowledge base or a phone line, so they measure the local speech/turn pipeline and do not validate grounded answer quality.

| Scenario | Completed | First audio p50 / p95 | Actual answer p50 / p95 |
|---|---:|---:|---:|
| English, 20 attempts, before turn-hold change | 16/20 | 0.59 / 0.74 s | 2.30 / 22.58 s |
| English, long comparison question, before turn-hold change | 3/3 sampled | 0.65 / 0.66 s | 2.34 / 2.40 s |
| English, same long question, with continuation hold | 5/5 | 1.32 / 1.74 s | 2.86 / 2.90 s |

The first English run had three missing completions and one model timeout; its actual-answer p95 is dominated by those tail cases. After the continuation hold, all five long-question runs produced a complete recognized transcript and completed the call. The added wait increased measured latency by about 0.5 s on this long-question sample. The under-one-second actual-answer target remains unmet.

First-audio numbers include the quick acknowledgement when one plays; use the actual-answer column for the caller's wait for the real response. The initial baseline JSON was captured before the test harness began snapshotting answer text after turn completion, so it has timing and transcript evidence but blank answer-text fields.

A 450 ms English endpoint experiment was reverted. In four long-question attempts, Whisper ended the first transcript after “plans” and the assistant began replying before the rest of the question arrived. Its 20-call run measured first-audio p50/p95 of 1.05/1.17 s and actual-answer p50/p95 of 2.61/2.73 s, and therefore did not deliver the intended latency improvement. Preserving the longer endpoint and joining the continuation produced correct turn boundaries in the five-repeat check.

Hindi/Hinglish accuracy is not signed off. The first mixed-language fixture sent Latin Hindi directly to Kokoro’s Hindi voice and produced invalid speech input. After correcting the fixture and transliteration, the local service restarted during the retest; the automated voice suite and focused mixed-script transliteration test pass, but a complete fresh Hindi/Hinglish end-to-end run is still needed. The configured AskG1 accuracy check also failed to fetch reliably, so the 5 November historical 13/16 grounded score is not a current before/after result.

## Reproduction artifacts

- [English 20-call baseline JSON](baseline/2026-11-14-standin-base-en.json)
- [Hindi/mixed 20-attempt baseline JSON](baseline/2026-11-14-standin-base-hi.json) (only successful turns are included)
- [English endpoint experiment JSON](baseline/2026-11-14-standin-after-en.json)
- [Five-repeat long-question check JSON](baseline/2026-11-14-stabilized-after-long-en.json)

Run `scripts/latency-baseline.sh <label>` with the local stack and configured model available to create a fresh paired English and Hindi/Hinglish run. Inspect the captured transcripts and answers with the timing rows; failed calls are excluded from percentiles and reported separately.

## Validation and limits

- `@voiceai/providers`: 145 tests passed; typecheck passed.
- `@voiceai/voice`: 141 tests passed; typecheck passed.
- `@voiceai/web`: typecheck passed, including the Studio code that uses the shared Hinglish conversion.
- `git diff --check` passed.
- No real-carrier Plivo test was run. Carrier delay, real handset audio, and live transfer behavior remain unverified.
