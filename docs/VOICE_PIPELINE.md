# Live voice pipeline (speech to speech)

```
caller audio -> speech-to-text (local Whisper, or Deepgram) -> AskG1 -> sentence splitter -> text-to-speech -> audio back to the caller
                      |  partial words / voice start                                              ^
                      +----------------- barge-in: stop audio, drop the reply, listen -------------+
```

Code: `apps/voice/src` (`pipeline.ts` is the conversation, `index.ts` the WebSocket server), adapters in `packages/providers`.

## Protocol (`ws://host:4001/stream?token=...`)

- The web app issues a 60-second signed token (`POST /api/voice/token`). Without a valid token the socket is refused.
- Client sends `{"type":"start","language":"en|hi|en-hi","voice":"pocket:alba|profile:<id>|dg:<id>","greeting":true}`, then raw 16 kHz 16-bit mono PCM in 20 ms binary frames, and `{"type":"stop"}` to end.
- Server sends JSON events (`ready`, `state`, `partial`, `user`, `assistant`, `clear`, `barge_in`, `timing`, `error`) and binary audio in the format announced by `ready`.
- `clear` means "throw away audio you have buffered": the caller interrupted.

## Behaviour worth knowing

- The AI **always opens with the disclosure** (AI assistant, call may be recorded).
- Reply sentences are spoken as soon as each is complete; a short opener like "Sure." goes out first.
- We send audio much faster than real time, so the service tracks how long the audio will keep playing. A caller who interrupts while buffered audio is still playing gets a `clear`, and the conversation memory is trimmed to the sentences the caller actually heard.
- Browser calls require recognized words before interrupting playback; raw speech-start detection can mistake the assistant coming through the speakers for the caller. Phone calls keep immediate speech-start barge-in.
- If the model fails before anything is spoken, a fallback message is spoken.
- Limits: 20 sessions (`MAX_SESSIONS`), 15 minutes per call (`MAX_CALL_MINUTES`), 64 KB per frame.
- Speech-end wait: `ENDPOINTING_MS` (Deepgram default 300 ms; local Whisper defaults to 650 ms for English and 400 ms otherwise). Local Whisper also holds visibly unfinished text for `TURN_HOLD_MS` (350 ms by default); if speech resumes during that window, it waits for the continuation transcript before answering.

Running it fully locally in English and Hindi: [LOCAL_VOICE_STACK.md](LOCAL_VOICE_STACK.md).

## Calls, hand-over and outbound checks

- **Saved calls.** When a signed-in user's call ends, the service writes the call log and the transcript (both sides, with times, and which sentences the caller talked over) to the database. The same call is never saved twice. A call where the caller said nothing is saved as missed.
- **Hand-over to a person.** The AI hands the call over when the caller asks for a person, makes a complaint, or has a payment problem (complaint and payment can be switched off in Settings), and after two failures in a row. It says the hand-over message (Hindi if the caller spoke Hindi), sends a `handoff` event with the reason, and stops answering. The Plivo transfer request and callback are implemented and covered by the phone simulator; transfer behavior on a real carrier call is not verified.
- **Outbound checks.** A `start` message with a `leadId` is checked before anything is spoken: Do Not Disturb, withdrawn or denied consent, and the calling hours (default 9am to 9pm India time, per organisation). A blocked call gets a `blocked` event and is closed, and the attempt is written to the audit log.
- **Session limit.** Counted from the moment a connection is accepted, so a burst of simultaneous calls cannot get past `MAX_SESSIONS`.

## Load test

`pnpm --filter @voiceai/voice load-test -- --calls 20 --concurrency 20` (20 calls at once) or `-- --calls 50 --concurrency 10 --turns 2` (50 scripted calls). It opens real sessions with spoken audio sent in real time. It reports first audio separately from the completed answer; an acknowledgement alone does not count as a completed response, and failed calls are excluded from latency percentiles. The optional `--json <path>` output records each question, recognized transcript, spoken answer, and timing stages so transcription and answer checks can be repeated against the same questions. The SOP first-audio gate is p50 ≤1.0 s and p95 ≤1.5 s. It needs `pnpm dev:stack` running, and it does not use a phone line. See the [14 Nov 2026 baseline and focused-change report](LATENCY_REPORT_2026-11-14.md) for current local results and limitations, and the [13 Nov report](LATENCY_REPORT_2026-11-13.md) for the earlier production-shaped load run.

## After the call
A worker summarises each call and applies the status and Do Not Disturb rules: see [POST_CALL.md](POST_CALL.md).

## Not built yet

The phone line is built but untested against real Plivo (see [PHONE_LINE.md](PHONE_LINE.md)). Not built: call recording, cost tracking, Exotel.

## Speed (28 Oct 2026)

Measured with the load test, one call at a time, real AskG1, backup model off, scripted spoken questions, one laptop running everything.

| | Start of day | After the changes |
|---|---|---|
| English, caller stops to first sound (median) | 2.70 s | 1.56 s |
| Hindi, same (median) | 8.6 to 10.1 s (27 Oct) | 5.78 s |

What changed and why:
- **Greetings do not wait for AskG1.** Simple greetings and “how are you?” get a short, language-aware response directly; plan questions still go through knowledge search and the model.
- **Named plans stay grounded.** If the requested named plan is not present in the retrieved company knowledge, the caller is told that details are unavailable and is offered a connection to the team. A “walk me through” request is instructed to include the price and features actually present in the knowledge base.
- **Small English speech model** (`WHISPER_URL_EN`, port 8770, started by `pnpm dev:stack` when `.local/models/ggml-small.en-q5_1.bin` exists). Decoding an utterance drops from about 1.3 s to 0.26 s; listening plus writing down the words from 1.10 s to about 0.3 s. Hindi and mixed calls keep the large model. It is weaker on strong accents: if English from real callers is misheard, remove the line from `apps/voice/.env.local`.
- **Short per-turn tags.** AskG1 reads new text at about 10 ms per token, so every word added to the caller's message is waiting time. The long instructions that used to ride on each message now live in the system prompt (which AskG1 keeps a saved copy of); each turn adds only `company knowledge: none` or the passages, plus a `reply language` tag for Hindi and Hinglish. The model is told never to read the note aloud.
- **Earlier turns are sent word for word** (notes included), so AskG1's saved copy of the conversation keeps matching instead of being re-read from the first caller line.
- **Keep-warm** (`ASKG1_KEEPWARM=off` to disable): a one-word request with the standard instruction at start-up and every 4 minutes. A request with an instruction AskG1 has not read recently waits 6 to 13 s.

What this does not fix: the 1.0 s gate is still not met. AskG1's own first word is 0.4 to 1.2 s depending on the time of day (the same request measured 0.3 to 0.5 s in the morning and 0.6 to 1.2 s later), and in Hindi the voice adds about 1.6 s because the speech is converted into the cloned voice. With a quiet AskG1 (0.4 s) English would land near 1.0 s. AskG1 also invents facts when no company knowledge matched (for example a price) even with the "do not guess" rule; this happened before these changes too.
