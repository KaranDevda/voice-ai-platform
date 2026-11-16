# Bizfy Voice AI

A multi-tenant platform for AI voice agents, call tracking and voice studio tooling. AskG1 is the only reasoning model. Speech-to-text, the voices and the cloned staff voices run on open-source tools on your own machine (Whisper, Pocket TTS, Kokoro, OpenVoice). Deepgram and ElevenLabs adapters exist but are not used. A carrier (Plivo or Exotel) will provide telephony.

## Status

| Phase | Scope | State |
|---|---|---|
| 0–1 | Monorepo, schema, RBAC, login with 2FA, voice profiles and consent | Done |
| Studio | 18-page web app: Studio, Clone, Transcribe, Agent Console, Library, Projects, Logs, Knowledge, Leads, Calls, Dialer, Reports, Voices, Team, Audit, Settings | Done, runs locally |
| 2 | Live conversation loop (streaming STT → AskG1 → TTS with barge-in) in English and Hindi, tested in the browser | Built; Hindi speed depends on AskG1 |
| 3 | Agent phone app and web dialer | Built |
| 4 | Post-call automation (worker, summary, sentiment) | Built |
| 5 | S3 recordings, security headers, rate limits | Built; AWS staging untested |

No telephony carrier is connected yet. Details of the live pipeline, its speed and its settings are in [docs/VOICE_PIPELINE.md](docs/VOICE_PIPELINE.md).

## Live conversation (English and Hindi)

| Step | English | Hindi and Hinglish |
|---|---|---|
| Listening | Whisper small.en (local, port 8770) | Whisper large-v3-turbo (local, port 8767, accurate setting) |
| Answer | AskG1, with the company knowledge base | AskG1, with the company knowledge base |
| Voice | Pocket TTS clone of the person | Kokoro Hindi voice, converted to the person's voice by OpenVoice |
| Instant reply | A short saved acknowledgement ("Sure.", "जी।") plays while AskG1 works | same |

- **Typical speed** (this MacBook Air M4, AskG1 warm): English real answer about 1.6 s, Hindi about 5 s.
- **Slow AskG1:** after 6 s a "one moment" line plays, the request is retried once at 12 s, and after 30 s the caller is asked to repeat. A slow model never causes a hand-over to a person.
- **Saved answers:** a repeated question with the same company knowledge is answered from memory, in the saved voice audio, without asking AskG1 again (cleared when the voice service restarts).
- **Optional Chatterbox voice:** `scripts/chatterbox-mlx-server.py` makes Studio Hindi directly from the speaker's saved recording on Apple silicon; it is slower than real time. Live Hindi in the person's own voice needs the GPU-backed `scripts/chatterbox-server.py`.
- **Warm-up:** AskG1 reads the long prompt slowly the first time (6–13 s). After a restart or a prompt edit run `pnpm --filter @voiceai/voice warm -- --voices "profile:<id>,profile:<id>"`.

## Stack

- **Web:** Next.js 15 (App Router), Tailwind v4
- **Data:** PostgreSQL 16 with Drizzle ORM, pgvector and row-level security (tenant isolation through `app.org_id`)
- **Voice service:** Express + ws, with Whisper (whisper.cpp), Pocket TTS, Kokoro and OpenVoice running locally
- **Queue:** Redis + BullMQ (post-call worker)
- **Tooling:** pnpm and Turborepo monorepo, TypeScript, vitest, GitHub Actions with Semgrep and dependency audit

## Layout

```
apps/
  web/            Next.js app: frontend and API routes
  voice/          Live call service: speech-to-text, AskG1, voices, barge-in
  worker/         Post-call jobs (summary, sentiment)
  agent-android/  Mobile agent app
packages/
  auth/           authorize(), permissions, roles, passwords, TOTP, secret box
  db/             Drizzle schema, migrations, queries, demo seed
  providers/      AskG1, Whisper, Pocket TTS adapters (Deepgram and ElevenLabs optional) and the stock voice list
  shared/         Domain types, phone masking, text and transcript helpers
  ui/             Shared UI
infra/terraform/  AWS staging (untested)
docs/             Running guide and ADRs
```

## Quick start

Needs Node, pnpm and a local Postgres 16.

```bash
pnpm install
pnpm dev:db                          # DESTRUCTIVE: recreates the local voiceai_dev database and loads demo data
pnpm dev:stack                       # local speech servers and the voice service (port 4001); keeps them running
pnpm --filter @voiceai/web dev       # http://localhost:3000 (Turbopack)
```

Create `apps/web/.env.local` with your database URL, session secrets and provider keys. The variables, demo logins and 2FA code command are in [docs/RUNNING.md](docs/RUNNING.md). Never commit `.env.local` files.

## Access control

Roles are Super Admin, Org Admin, Manager, Agent, QA Auditor and Viewer. Permissions are scoped strings (`all`, `team`, `own`, `aggregate`), and data outside a user's scope looks the same as missing data. Org Admins and Managers can use Studio. QA Auditors see masked phone numbers. Role bundles live in [packages/auth/src/roles.ts](packages/auth/src/roles.ts).

## Checks

```bash
pnpm typecheck
pnpm test
```

Database integration tests are skipped unless `TEST_DATABASE_URL` and `TEST_APP_DATABASE_URL` are set; CI sets them. The local database has no pgvector, so the knowledge base searches by keyword there. CI tests the real vector column.

## Known gaps

- AskG1 sometimes stalls for 10–40 s and is only reachable over Tailscale, through a relay. Reserved capacity, a direct route and prompt-cache changes require the AskG1 operator.
- Hindi live replies are slower than English. Kokoro + OpenVoice is the current local path; Chatterbox MLX does not stream and exceeded 60 s for a short Hindi synthesis in this environment. A fast cloned Hindi live voice needs a measured GPU-backed streaming service.
- Plivo inbound/outbound, signed webhooks and transfer flows are implemented and pass `phone-sim`, but no carrier account/number is configured here and real-call behavior is untested.
- Real Android/iOS handsets and carrier audio quality have not been tested.
- AWS staging passed `terraform validate` only. Planning/applying needs an approved AWS account, state bucket, domain and TLS certificate.
- Production India telephony still needs carrier KYC, DLT registration and DND scrubbing.
- Semantic embedding ingestion/search is implemented but opt-in: configure `EMBEDDING_URL`, `EMBEDDING_MODEL`, and an endpoint that returns 1536-dimensional vectors; production PostgreSQL must have pgvector. Without configuration, search remains keyword-based.
- Password reset is implemented with single-use links; new-phone alerts are implemented. Both require configured SMTP, which is not set in this workspace.
