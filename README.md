# Bizfy Voice AI

A multi-tenant platform for AI voice agents, call tracking and voice studio tooling. AskG1 is the reasoning engine, Deepgram handles speech-to-text and stock voices, cloned staff voices come from the free self-hosted Pocket TTS (see [docs/POCKET_TTS.md](docs/POCKET_TTS.md)) or ElevenLabs, and a carrier (Plivo or Exotel) will provide telephony.

## Status

| Phase | Scope | State |
|---|---|---|
| 0–1 | Monorepo, schema, RBAC, login with 2FA, voice profiles and consent | Done |
| Studio | 18-page web app: Studio, Clone, Transcribe, Agent Console, Library, Projects, Logs, Knowledge, Leads, Calls, Dialer, Reports, Voices, Team, Audit, Settings | Done, runs locally |
| 2 | Live conversation loop (streaming STT → AskG1 → TTS with barge-in), tested in the browser; carrier (Plivo or Exotel) not connected | Core built |
| 3 | Android and iOS agent app, dialer calls | Not started |
| 4 | Post-call automation (worker, BullMQ) | Not started |

`apps/worker` is a stub, and `apps/agent-android` is only a README. `apps/voice` runs the live conversation (see [docs/VOICE_PIPELINE.md](docs/VOICE_PIPELINE.md)). No telephony carrier is connected yet.

## Stack

- **Web:** Next.js 15 (App Router), Tailwind v4
- **Data:** PostgreSQL 16 with Drizzle ORM, pgvector and row-level security (tenant isolation through `app.org_id`)
- **Voice service:** Express + ws (Phase 2)
- **Queue:** Redis + BullMQ (Phase 4)
- **Tooling:** pnpm and Turborepo monorepo, TypeScript, vitest, GitHub Actions with Semgrep and dependency audit

## Layout

```
apps/
  web/            Next.js app: frontend and API routes
  voice/          Call audio service (stub)
  worker/         Background jobs (stub)
  agent-android/  Mobile agent app (README only)
packages/
  auth/           authorize(), permissions, roles, passwords, TOTP, secret box
  db/             Drizzle schema, migrations, queries, demo seed
  providers/      Deepgram, ElevenLabs, AskG1 adapters and the stock voice list
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
pnpm --filter @voiceai/web dev       # http://localhost:3000
pnpm --filter @voiceai/voice dev     # http://localhost:4001 (health check only for now)
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

- AskG1's API format is assumed to be OpenAI-compatible and is unverified. It is only reachable on the company VPN.
- Real devices, a real microphone and Hindi voice quality are untested.
- Telephony depends on the company's KYC for an Indian number, plus DLT registration and DND scrubbing.
- Still to build: embeddings, S3 recordings, rate limits, password reset and new-device alerts.
