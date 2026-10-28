# Security (Phase 5)

What is in place, what is checked, and what is still open. Only what is tested is marked as done.

## In place and tested
- **Dependencies:** `pnpm audit` reports no known vulnerabilities (CI fails on high). Zod 4, `body-parser` and `esbuild` are pinned past the flagged versions in `pnpm-workspace.yaml`.
- **Recordings in S3** (`packages/providers/src/s3-recordings.ts`): set `RECORDINGS_BUCKET` (and `RECORDINGS_REGION`) on the website and the worker. Objects are written with KMS encryption; playback is a redirect to a signed link that lasts 5 minutes, issued only after the call-access check and audit row. Unit-tested without AWS (what is sent, and the signed link's expiry). With no bucket set, recordings stay in `RECORDINGS_DIR` as before.
- **Retention** also deletes the S3 object, not only the database row.
- **Security headers** on every page and API response: no framing, no MIME sniffing, strict referrer, microphone only for this site, HSTS, and a CSP that closes framing, plug-ins, `<base>` and foreign form targets.
- **Rate limits:** sign-in and `/api/auth/*` 20 per minute per address, other API calls 600 per minute per address (`packages/shared/src/rate-limit.ts`). Per server, in memory. Existing limits remain: account lockout, pairing codes, phone check-call, per-device sync.

## Not done, and why
- **Verified against real AWS:** nothing here has been run against AWS. `infra/terraform/staging` passes `terraform validate` only; it needs an AWS account (CEO approval, it costs money) and a first `terraform plan`. See its README for the runbook.
- **Limit shared across servers:** needs a WAF rule or Redis. Terraform has a load balancer (not applied) but no WAF yet.
- **Password reset and new-device alerts:** both send email. There is no email provider chosen (for example SES). Decision needed before building.
- **Full CSP for scripts:** `script-src` is left open because Next injects inline scripts; tightening needs per-request nonces.
- **Penetration test / external review:** not done.
