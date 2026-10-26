# Free voice engine: Pocket TTS

Bizfy Voice AI can speak and clone voices with **Kyutai Pocket TTS** instead of ElevenLabs. It is free (MIT licence), runs on a CPU, and keeps voice data on our own machines. ElevenLabs stays available as an alternative.

## One-time setup (macOS, Apple silicon)

1. Download the standalone binary (no Python needed) from <https://github.com/kyutai-labs/pocket-tts/releases>, check it against `SHA256SUMS`, and put it at `.local/pocket-tts/pocket-tts` (`chmod +x`). The `.local/` folder is gitignored.
2. **Cloning needs a Hugging Face account.** Open <https://huggingface.co/kyutai/pocket-tts>, accept the terms, create a **Read** token, and put it in `apps/web/.env.local` as `HF_TOKEN=...`. Never paste the token into chat or commit it.
3. In `apps/web/.env.local` set:
   ```
   POCKET_TTS_URL=http://127.0.0.1:8765
   POCKET_TTS_BIN="/absolute/path/to/repo/.local/pocket-tts/pocket-tts"
   ```
   The same `POCKET_TTS_URL` (and `SESSION_SECRET`) go in `apps/voice/.env.local`.

## Every day

```bash
pnpm dev:tts                          # the voice server, port 8765 (first run downloads the model)
pnpm --filter @voiceai/web dev        # web app
pnpm --filter @voiceai/voice dev      # live conversation service, port 4001
```

## How cloning works

1. In **Voice clone**, a staff member's consent is recorded, then the recording is made. The browser joins the clips into one 24 kHz WAV.
2. The server runs `pocket-tts export-voice`, which turns the recording into a reusable **voice file** (about 10 MB, `.local/voices/<id>.safetensors`). The raw recording is deleted straight away.
3. When speaking, the TTS server fetches that file from `/api/internal/voice-files/<signature>/<id>.safetensors`. The address is signed and answers 404 for anything wrong. Sending the recording with every request instead is about 750 ms slower.
4. **Revoking** a voice deletes the file and the voice stops working immediately.

A voice file is biometric data. In production store it encrypted, keep the TTS server on a private network, and never expose the voice-file route to the internet.

## Choosing the engine

`CLONE_PROVIDER=pocket_tts` or `elevenlabs` (default: Pocket TTS when `POCKET_TTS_URL` is set). Existing clones keep working with whichever engine made them.

## Known limits

- English is the default model. Hindi needs a separate community model (for example `hf://saryps-labs/pocket-tts-hindi/config.yaml`, CC BY 4.0, described by its authors as a research checkpoint) and its own server. Listen to it before relying on it.
- Output is 24 kHz. Phone calls use 8 kHz µ-law; the adapter converts it.
- Measured on an Apple M4: first audio about 30 ms, a full sentence about 300 ms. A cloud server will differ, so measure there.
- Fish Speech was evaluated and rejected for production: its licence needs a paid agreement for hosted services.
