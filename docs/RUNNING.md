# Running the platform locally

## One-time setup
```bash
pnpm install
# Postgres 16 must be running locally.
pnpm dev:db        # DESTRUCTIVE: drops and recreates the local voiceai_dev database, applies migrations, loads demo data
```

## Every day
Two terminals in the repo root.

**Terminal 1: web app (frontend + API)** at http://localhost:3000
```bash
pnpm --filter @voiceai/web dev
```

**Terminal 2: voice service** at http://localhost:4001 (only `/healthz` for now; the live call loop is Phase 2)
```bash
pnpm --filter @voiceai/voice dev
```

## Demo logins
Password for all: `Passw0rd-long!`

| Email | Role |
|---|---|
| admin@demo.io | Org Admin: everything |
| manager.north@demo.io, manager.south@demo.io | Manager: own team, studio (own projects) |
| asha@demo.io, ravi@demo.io, meera@demo.io, kabir@demo.io | Agent: own leads and calls |
| qa@demo.io | QA Auditor: read-only calls |
| viewer@demo.io | Viewer: summary numbers only |

Admin, managers and QA ask for a 2FA code: `pnpm demo:code` (changes every 30 s).

## Environment (`apps/web/.env.local`, gitignored)
| Variable | What for |
|---|---|
| `DATABASE_URL`, `SESSION_SECRET`, `MFA_ENCRYPTION_KEY` | Required. Generate secrets with `openssl rand -hex 32` and `openssl rand -base64 32`. |
| `DEEPGRAM_API_KEY` | Transcription and stock voices (Studio, Transcribe, Library, console microphone). |
| `ELEVENLABS_API_KEY` | Cloned staff voices (Voice clone, cloned voices in Studio). Optional `ELEVENLABS_BASE_URL`, `ELEVENLABS_MODEL_ID`. |
| `ASKG1_API_KEY`, `ASKG1_BASE_URL`, `ASKG1_MODEL` | Agent console. AskG1 is only reachable on the company VPN (`tailscale up --login-server=https://vpn.bizfylabs.com`). |

The Launchpad shows which of these are connected. A missing key never breaks the app: the feature that needs it says so.

## Checks
```bash
pnpm typecheck
pnpm test        # database integration tests need TEST_DATABASE_URL and TEST_APP_DATABASE_URL (see the CI workflow)
```
