# The phone line (Plivo)

How a real phone call reaches the AI, what is built, and what is not proven. Written 27 Oct 2026.

## How a call flows
1. **Incoming call** to our Plivo number. Plivo asks `POST /plivo/answer` what to do. We check Plivo's signature (V3), then answer with an instruction to open a two-way audio stream to `wss://.../plivo/stream`, carrying a 2-minute signed token.
2. **Audio.** Plivo sends the caller's voice as 8 kHz µ-law in 20 ms messages. We convert it to 16 kHz for speech recognition, run the normal conversation (AskG1 or the backup, knowledge base, hand-over rules), and send the AI's voice back as `playAudio` messages. When the caller talks over the AI, `clearAudio` drops what Plivo had queued.
3. **Hand-over.** When the caller asks for a person (or complains, or has a payment problem), the AI says the hand-over line and, once it has finished, asks Plivo to move the call (`POST /Call/<id>/`). Plivo then fetches `POST /plivo/transfer`, which answers with a `Dial` to `PLIVO_HANDOFF_NUMBER`.
4. **End.** When the stream stops, the call is saved to the call log with its transcript, exactly like a browser call. An incoming call is filed under the lead with the caller's number, when there is one.
5. **Outbound.** `POST /plivo/outbound` (signed voice token, body `{leadId, language}`) runs the Do Not Disturb, consent and 9am-9pm check, and only then asks Plivo to dial the lead. A blocked lead is never dialled.

Browser calls and phone calls share one session builder (`buildSession` in `apps/voice/src/index.ts`), so the voice, knowledge, hand-over rules, checks and call saving are identical.

## Settings
See `.env.example` (PLIVO_*, PUBLIC_BASE_URL). The Plivo number's answer URL must be `PUBLIC_BASE_URL/plivo/answer` (method POST). In development use a tunnel that gives a public https address, and set PUBLIC_BASE_URL to exactly that address, because Plivo signs requests with the address it called.

## Tested
`pnpm --filter @voiceai/voice phone-sim` plays the carrier: it signs requests like Plivo, opens the stream, speaks to the AI, interrupts it, asks for a person, and acts as Plivo's REST API. 12 checks pass: unsigned and tampered requests refused, the stream answers by voice, interruption clears the queue, hand-over reaches the carrier, outbound is refused without a token and for Do Not Disturb leads, and an allowed lead is dialled. Plus unit tests for the signature, XML, stream messages and REST calls (`packages/providers/src/plivo.test.ts`).

## NOT proven
- **It has never talked to real Plivo.** Written from Plivo's documentation and the signature code in Plivo's own Python library. Field names in Plivo's `start` message (call and stream ids) are read tolerantly, but the first real call may still need small fixes.
- **Call quality on a real phone line:** noise, accents and the carrier's own delay are untested. The latency numbers do not include the carrier network.
- **Transfer details:** Plivo's transfer behaviour (the caller's leg, ringing the person, what if they do not answer) is assumed from the documentation. There is no "person did not answer, come back to the AI" step yet.
- **Not built:** call recording from the carrier, cost tracking per call, a status callback for calls that never connect, Exotel as an alternative.
- **The stream URL carries a short-lived signed token** (2 minutes for the stream, 10 minutes for the answer address of an outbound call), which can appear in the carrier's logs.
