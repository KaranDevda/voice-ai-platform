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
- If the model fails before anything is spoken, a fallback message is spoken.
- Limits: 20 sessions (`MAX_SESSIONS`), 15 minutes per call (`MAX_CALL_MINUTES`), 64 KB per frame.
- Speech-end wait: `ENDPOINTING_MS` (default 300). Lower is faster but cuts off people who pause.

Running it fully locally in English and Hindi: [LOCAL_VOICE_STACK.md](LOCAL_VOICE_STACK.md).

## Calls, hand-over and outbound checks

- **Saved calls.** When a signed-in user's call ends, the service writes the call log and the transcript (both sides, with times, and which sentences the caller talked over) to the database. The same call is never saved twice. A call where the caller said nothing is saved as missed.
- **Hand-over to a person.** The AI hands the call over when the caller asks for a person, makes a complaint, or has a payment problem (complaint and payment can be switched off in Settings), and after two failures in a row. It says the hand-over message (Hindi if the caller spoke Hindi), sends a `handoff` event with the reason, and stops answering. The hand-over is written to the audit log. On a real phone call the carrier adapter does the actual transfer; that part is not built, because it needs the carrier.
- **Outbound checks.** A `start` message with a `leadId` is checked before anything is spoken: Do Not Disturb, withdrawn or denied consent, and the calling hours (default 9am to 9pm India time, per organisation). A blocked call gets a `blocked` event and is closed, and the attempt is written to the audit log.
- **Session limit.** Counted from the moment a connection is accepted, so a burst of simultaneous calls cannot get past `MAX_SESSIONS`.

## Load test

`pnpm --filter @voiceai/voice load-test -- --calls 20 --concurrency 20` (20 calls at once) or `-- --calls 50 --concurrency 10 --turns 2` (50 scripted calls). It opens real sessions with spoken audio sent in real time and reports the time from the end of the question to the first word, against the gate of a median under 1.0 s. It needs `pnpm dev:stack` running, and it does not use a phone line.

## After the call
A worker summarises each call and applies the status and Do Not Disturb rules: see [POST_CALL.md](POST_CALL.md).

## Not built yet

The phone line is built but untested against real Plivo (see [PHONE_LINE.md](PHONE_LINE.md)). Not built: call recording, cost tracking, Exotel.
