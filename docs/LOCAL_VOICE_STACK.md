# Local voice stack (free, runs on one Mac)

Speech-to-text, the English voice and the Hindi voice all run on this machine. Nothing is sent to a cloud provider. AskG1 is the only outside piece (company VPN).

| Piece | What | Port | Start |
|---|---|---|---|
| Speech-to-text | whisper.cpp with Whisper large-v3-turbo (quantised), English and Hindi | 8767 | `pnpm dev:stack` |
| English voice | Pocket TTS (MIT) | 8765 | `pnpm dev:stack` |
| Hindi voice | **Kokoro** (Apache 2.0): fixed male and female Hindi voices, cannot clone. Falls back to the Pocket Hindi community model only if Kokoro is not installed | 8768 | `pnpm dev:stack` |
| Voice service | `apps/voice`, joins the pieces to AskG1 | 4001 | `pnpm --filter @voiceai/voice dev` |
| Web app | `apps/web` | 3000 | `pnpm --filter @voiceai/web dev` |

## Demo mode (when AskG1 is unreachable)

`pnpm dev:voice-demo` starts the voice service with a **stand-in** for AskG1 ([scripts/fake-askg1.mjs](../scripts/fake-askg1.mjs)). It only knows the business and premium plan prices, in English and Hindi, and prints a banner saying so. Say out loud that the AI is a stand-in when you show it. For the real thing, run `pnpm --filter @voiceai/voice dev` once `ASKG1_BASE_URL` points at AskG1's API.

The voice service accepts pages from `http://localhost:3000` and `:3001` (`WEB_ORIGIN`, comma separated). In production set it to the real web address only.

## Who it listens to (the Live conversation setting)

| Mode | What it does | Use it |
|---|---|---|
| Only me, close to the microphone (default) | Ignores speech clearly quieter than the person at the mic (under about 45% of their level), and drops transcripts Whisper is unsure of | In a room with other people. Speak at normal volume near the mic. |
| Hold to talk (Space bar) | The microphone is replaced by silence until you hold the button or Space | Noisy rooms, demos in front of an audience. The most reliable. |
| Anyone nearby | Hears every voice it can pick up | A quiet room, alone |

A loud person right next to the microphone, or someone speaking as loudly as you, will still be heard in the first mode: it judges loudness, not who is speaking. Use hold-to-talk there. Headphones stop the AI hearing itself.

## Demo AI (until AskG1's API address is known)

`pnpm dev:voice-demo` picks the AI automatically and prints a banner saying it is a stand-in:
- **A small local model** (Llama 3.2 3B in `.local/models`, run by llama.cpp on port 8090) when its file is complete: answers general questions in English and Hindi, but is less capable than AskG1 and sometimes wordy or wrong in Hindi.
- **Fixed answers** otherwise (plan prices only, [scripts/fake-askg1.mjs](../scripts/fake-askg1.mjs)).

Choose with `DEMO_AI=llama` or `DEMO_AI=fixed`. Download the model with several parallel connections (one connection can be 10 times slower) and check it is exactly 2019377696 bytes with SHA-256 `6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff`; the script refuses a partial file. Running the script again replaces its own older copy and never touches other programs.

## How answers stay precise

For a signed-in user the voice service builds each answer from three things:
1. **The organisation's own AI instruction and greeting** (Settings), so the company decides how the AI behaves.
2. **Voice rules** that keep replies to one or two short sentences, answer exactly what was asked, ask a short question when unsure, and never use markdown or emoji ([apps/voice/src/prompt.ts](../apps/voice/src/prompt.ts)).
3. **The knowledge base:** the paragraphs that match the caller's question. If nothing matches, the model is told not to guess about Bizfy's plans, prices or policies and to offer a person. In testing, a question about a plan that is not in the knowledge base got "I do not have information on a premium plan" instead of an invented price.

Simple greetings and “how are you?” are answered locally without waiting for AskG1. If the requested named plan is absent from retrieved knowledge, the service gives a safe response and offers a team connection rather than substituting another plan's details. Plan walk-through answers are instructed to include the price and features present in the organisation's knowledge; add missing plan details there for a complete answer.

Limits:
- **Knowledge search has two modes.** With `EMBEDDING_URL` and `EMBEDDING_MODEL` configured in both web and voice environments, uploaded chunks and live questions use 1536-dimensional semantic vectors, including Hindi queries. With no embedding endpoint, search falls back to English keywords and the Hindi glossary in [knowledge.ts](../apps/voice/src/knowledge.ts).
- **The Hindi voice skips digits.** Every number in a Hindi sentence is spelled out in Hindi words before it is spoken. Without this a price is silently missing.
- A 3B model sometimes misattributes facts in Hindi (it once gave Enterprise features to the Business plan). AskG1 should do better.

## Hindi and Hinglish: why Kokoro

The Pocket Hindi model could clone a voice but was unreliable: with a real recording it produced garbage ("लुट लुट लुट") and server errors, and even the default voice scored only 0.70 when read back. Kokoro scored 0.77 on the same test, never failed, and is about four times faster than real time. The trade-off is that **Kokoro cannot clone**: Hindi and Hinglish are spoken by a built-in Hindi voice (`hm_omega` for male, `hf_alpha` for female, matched to the person's gender), and plain English is still spoken in the person's cloned voice. A sentence that contains any Hindi is spoken wholly by Kokoro, so one sentence never changes voice halfway. For a closer Hindi voice match in Studio, use Chatterbox Multilingual below.

Setup: `python3.13 -m venv .local/kokoro-venv && .local/kokoro-venv/bin/pip install kokoro-onnx soundfile`, then download `kokoro-v1.0.onnx` (310 MB) and `voices-v1.0.bin` from <https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0> into `.local/models/`. Set `KOKORO_URL=http://127.0.0.1:8768` in `apps/web/.env.local` and `apps/voice/.env.local`. `pnpm dev:stack` starts it automatically when both exist.

To use the Pocket Hindi model for cloned Hindi instead of Kokoro, leave `KOKORO_URL` unset in both `apps/web/.env.local` and `apps/voice/.env.local`, and configure `POCKET_TTS_HI_URL` and `POCKET_TTS_HI_CONFIG` in each as described below. Hindi speech then uses each clone's Hindi voice file directly; the model is less reliable than Kokoro.

## Hindi and Hinglish in the person's own voice

Kokoro speaks Hindi well but only in fixed voices. A second model, the **OpenVoice v2 tone-colour converter** (MIT), changes the timbre of that audio to the cloned person's, keeping the words and rhythm. Measured on this Mac: the converted voice moves from 0.32 to 0.43 similarity to the target up to 0.81 to 0.86 (1.0 = identical), Whisper understands the Hindi just as well, and a 7-second sentence converts in about 1.3 to 1.6 s.

- **At clone time** the recording is also turned into a small **voice fingerprint** (`<id>.se.pt` in `.local/voices`, biometric data, deleted when the voice is revoked). The raw recording is still deleted.
- **When speaking** any sentence containing Hindi is made by Kokoro, then changed into the person's voice in one pass, so a Hinglish sentence has one voice. Plain English still uses the Pocket clone.
- **Falls back, never fails:** a voice with no fingerprint (cloned before this existed), or a conversion server that is down, speaks the built-in Hindi voice, and Studio and Live say so. Older voices get a fingerprint from a fresh recording under Voice clone, "Add Hindi to an existing voice".
- **Cost:** about a second more per Hindi sentence. Not streamed.
- **Setup:** `python3.13 -m venv .local/ov-venv`, then `.local/ov-venv/bin/pip install torch numpy scipy librosa soundfile pydub inflect unidecode eng_to_ipa pypinyin cn2an jieba langid requests`; `git clone --depth 1 https://github.com/myshell-ai/OpenVoice .local/openvoice`; download `converter/checkpoint.pth` and `converter/config.json` from <https://huggingface.co/myshell-ai/OpenVoiceV2> into `.local/models/openvoice-v2/converter/`. Set `VOICE_CONVERT_URL=http://127.0.0.1:8769` in both env files. `pnpm dev:stack` starts it.
- Its source is third-party code: it was read before use (no network calls, no command execution) and its model loads with PyTorch's safe loader. The server is bound to 127.0.0.1.

## More natural Studio Hindi: Chatterbox Multilingual

OpenVoice changes the timbre of Kokoro speech. For a closer match, Studio can instead generate Hindi and Hinglish directly from the cloned speaker's saved recording with Chatterbox Multilingual on Apple silicon. This mode is optional and off by default because longer scripts can take minutes. If a direct generation exceeds 45 seconds, Studio uses the faster Kokoro-plus-OpenVoice path instead. Live calls do not use this model by default: the MLX model does not stream and a short local Hindi synthesis exceeded 60 seconds in the current environment. A real-time cloned Hindi voice needs a separately provisioned GPU server and measured streaming support.

- **Setup:** `python3.13 -m venv .local/mlx-venv && .local/mlx-venv/bin/pip install mlx-audio soundfile`. Set `CHATTERBOX_URL=http://127.0.0.1:8771` in `apps/web/.env.local`, then run `.local/mlx-venv/bin/python scripts/chatterbox-mlx-server.py`. The first run downloads `mlx-community/chatterbox-multilingual-v3`; `pnpm dev:stack` starts the server automatically once the environment exists.
- Chatterbox uses the voice's existing consented reference recording from `.local/voices`; the local server binds to 127.0.0.1. Do not set `CHATTERBOX_URL` in `apps/voice/.env.local` unless accepting its extra latency in live conversations.

## One-time setup

Everything lives in `.local/` (gitignored). Download only from the official sources and check the checksum.

1. **Pocket TTS binary:** see [POCKET_TTS.md](POCKET_TTS.md). Needs the Hugging Face token for cloning.
2. **whisper.cpp:** `git clone --depth 1 --branch v1.9.2 https://github.com/ggml-org/whisper.cpp .local/whisper.cpp`, then `cd .local/whisper.cpp && cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j 8 --target whisper-server`. Uses the Mac's GPU automatically. Use the v1.9.2 tag: the newest code (v1.9.5 and later, checked 5 Nov 2026) fails to compile its Metal shaders on this Mac and the server aborts at start-up.
3. **Whisper model** (574 MB): `curl -L -C - -o .local/models/ggml-large-v3-turbo-q5_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin`. The download can stop short without an error: check that `shasum -a 256` is `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2`. A truncated file makes Whisper print random words in many languages.
4. **Settings:** in `apps/web/.env.local` set `POCKET_TTS_URL`, `POCKET_TTS_BIN`, `POCKET_TTS_HI_URL=http://127.0.0.1:8768` and `POCKET_TTS_HI_CONFIG="hf://saryps-labs/pocket-tts-hindi/config.yaml@dbaa326069d20bfbdaeb625613736773741a24ea"`. In `apps/voice/.env.local` set `WHISPER_URL=http://127.0.0.1:8767`, `POCKET_TTS_URL`, `POCKET_TTS_HI_URL`, `SESSION_SECRET` (same value as the web app), `DATABASE_URL`, and the AskG1 keys. `STT_PROVIDER=deepgram` switches speech-to-text back to the cloud.

## Languages and voices

- **Speech-to-text language** follows the Caller language setting on the Live page; "English and Hindi mixed" lets Whisper detect it per utterance.
- **The reply is spoken by the model that matches its script:** Devanagari goes to the Hindi voice, everything else to the English voice, sentence by sentence.
- **A voice file only works with the model that made it.** Cloning makes an English file and a Hindi file from the one recording. Voices cloned before the Hindi model was set up have English only: **Voice clone, Add Hindi to an existing voice**, with a fresh recording, adds it. Until then Hindi is spoken in the Hindi model's default voice and the Live page says so.

## Measured (Apple M4, stand-in AskG1 starting after 355 ms)

| | English | Hindi |
|---|---|---|
| Caller stops talking to first AI sound | 1.29 to 1.35 s | 1.38 to 1.44 s |
| Whisper on one utterance | about 0.5 s | about 0.5 s |

The speech-to-text is the slowest part: the caller must be silent for 700 ms by default on Hindi/Hinglish (`ENDPOINTING_MS`), and the large Whisper model then takes 0.5 to 1.3 s. English uses 650 ms by default to avoid splitting short pauses between clauses; the small model (`WHISPER_URL_EN`, see VOICE_PIPELINE.md "Speed") takes about 0.26 s.

## Known limits

- Hindi is understandable but less reliable than English: the read-back similarity in tests varied from 0.12 to 0.54 (English 0.62). A native Hindi speaker must judge it.
- Interruptions are detected by loudness, with no words to confirm them. Use headphones, or the AI will hear itself.
- The Hindi model is described by its authors as a research checkpoint. Confirm their terms before a commercial launch.

## When AskG1 is down: the backup AI

`pnpm dev:stack` also starts Llama 3.2 3B (llama.cpp, port 8090) when its model file is complete. The voice service uses it only when AskG1 cannot be reached, errors, or does not start answering within 8 seconds (`ASKG1_FIRST_TOKEN_TIMEOUT_MS`). Set `LOCAL_LLM_URL=http://127.0.0.1:8090` in `apps/voice/.env.local` (already in `.env.example`). The Live page shows a notice whenever the backup is the one answering, and the log says `AskG1 skipped (...)`.

The backup is a small model: it follows the knowledge base reasonably in English, and is noticeably weaker in Hindi (it can make up plan names or get a yes/no wrong). It is a safety net so calls do not fail, not a replacement for AskG1. After the first failure the service goes straight to the backup for 2 minutes, then tries AskG1 again.
