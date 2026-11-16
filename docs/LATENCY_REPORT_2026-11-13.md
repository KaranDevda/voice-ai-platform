# Voice latency report — 13 November 2026

## Executive result

**The live-answer target is not met.** A warm, single English call took **2.96 s** to deliver the actual answer. In the 50-call, 20-concurrent run, actual-answer latency was **16.42 s p50 / 29.67 s p95**, and only **27 of 50** calls completed.

The quick acknowledgement can make the call sound responsive: first audio was **0.49 s** in the single-call sample and **0.49 s p50** under load. That is not the time to the answer. The load-test now reports these separately.

This is a latency report, not a full SOP sign-off.

## SOP targets and latest English measurements

The SOP's page 5 budget is approximately **0.8–1.0 s to first audio**: carrier/server network under 100 ms, end-of-speech STT 250–300 ms, AskG1 first token with RAG 300–400 ms, and TTS first chunk 150–250 ms. Page 13 acceptance calls for first-audio **p50 ≤1.0 s and p95 ≤1.5 s**, 20 concurrent calls without drops, and 50 scripted calls.

| Run | First audio | Actual answer | Completion |
|---|---:|---:|---|
| One warm English call | 0.49 s | **2.96 s** | Answer arrived; target missed |
| 50 attempts, 20 concurrent | p50 **0.49 s**, p95 **22.08 s** | p50 **16.42 s**, p95 **29.67 s** | **27/50** completed; 15 refused with HTTP 503; 8 timed out |

In the single-call sample, AskG1's first token took **1.88 s**, the first sentence **2.31 s**, and TTS first audio **0.17 s**. In the concurrent run, median AskG1 first-token time was **15.33 s**. Peak open sessions reached **20**. Acknowledgements played on 23 of the 27 completed calls, demonstrating why first audio alone can overstate responsiveness.

**Gate: NOT MET.** The 20-way run misses the SOP p95 first-audio threshold, the under-one-second actual-answer target, and the no-drops concurrency requirement.

## Hindi and speech-recognition evidence

These are earlier, separate tests—not a same-day Hindi end-to-end AskG1 load test:

- **3 Nov provisional live baseline:** Hindi/Hinglish caller-stop-to-real-answer was **3.76 s p50 / 6.12 s p95**. AskG1 was unavailable; a local Llama model was used and some answers were cached. Do not treat this as an AskG1 result.
- **3 Nov Hindi STT comparison:** on 10 synthetic spoken phrases, Sarvam measured **0.26 s p50 / 0.58 s p95** at 1.0% character error; local Whisper small **0.97 / 1.07 s** at 19.0%; Deepgram Nova-3 **1.01 / 2.52 s** at 24.1%. Synthetic audio and a small sample limit these conclusions. Sarvam was not enabled in the live configuration recorded by that test.
- **5 Nov local Hindi STT tuning:** the current large-v3-turbo setting measured **0.94 s median** at 12.0% character error. Faster settings saved up to about 0.3 s but increased error by 3–5 percentage points, so the accuracy trade-off was not adopted.
- **28 Oct historical end-to-end first-sound results:** English **1.56 s median**, Hindi **5.78 s median** after that day's changes. These were single-call results and are not directly comparable to the 13 Nov stress test.

There is **no current, apples-to-apples Hindi live-answer benchmark** with AskG1, the selected Hindi voice path, the real organization knowledge base, and carrier audio.

## Test scope and caveats

- The 13 Nov load test used a local WebSocket and synthetic spoken input, not a Plivo/real phone call. Carrier network delay is not included.
- It used a synthetic no-save identity: **no Karan-specific prompt or RAG was loaded** (`groundMs` was 0). The run measures the local configured service under load, not a grounded production agent.
- At the time of the check, configuration showed `MAX_SESSIONS=20`, `ASKG1_MAX_CONCURRENT=3`, and no local backup model URL. The service health endpoint was healthy with zero sessions after the run.
- Real-carrier latency, human transfer on a real carrier, real-device quality, and barge-in audio-stop timing were not measured. AWS staging is also not verified.
- The final load-test reporting/filtering changes were typechecked after the stress run; the stress run itself was not repeated after those changes.

## Work completed today (13 Nov)

- Fixed local Live's English TTS availability and verified its health endpoint; identified that `pnpm dev:stack` separately lacks the local Whisper executable.
- Switched Hindi live voice back to Kokoro + OpenVoice after evaluating Chatterbox; generated Karan's missing OpenVoice fingerprint from the existing consented sample and verified synthesis/conversion.
- Added a download control for completed voice-cloning recordings and checked the Suhani re-clone preflight/consent setup.
- Improved direct, language-aware greeting replies and grounded missing-plan responses; expanded prompt guidance and focused tests.
- Added optional knowledge embeddings, first-time mobile-device email alerts, clarified password-reset status, and fixed the local demo port collision. New-device email still requires SMTP; existing knowledge needs re-upload for embeddings.
- Updated the load-test to distinguish acknowledgement audio from a completed answer, exclude failed calls from latency statistics, and report SOP first-audio and real-answer gates.
- Validation recorded today: focused voice suite (**61 passed**), repository typecheck/tests and `git diff --check` passed; database integration tests requiring configured test DB URLs were skipped. Terraform validation passed, but AWS deployment was not tested.

## Recommended next steps

1. Secure reserved/direct AskG1 capacity or a reliable fallback, then rerun the 50-call/20-concurrent test.
2. Benchmark a grounded test identity with the actual organization prompt and knowledge base; separately run Hindi and English.
3. Run the same scripted checks through real Plivo and real devices, including transfer, network delay, and barge-in stop time.
4. Re-run the acceptance suite after changes; keep first acknowledgement, first answer audio, and completed answer latency as separate metrics.
