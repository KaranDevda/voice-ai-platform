# Feature checklist status

This is an implementation audit of the supplied product list. “Implemented” means there is application code; it does not mean a production provider has been configured or tested. Recheck this file as integrations are added.

## Implemented in the current application

- Local live voice conversation, streaming transcript/partials, turn handling, interruption support, knowledge-grounded answers, transfer flow, call recording/transcription, post-call sentiment and lead analysis.
- AskG1 plus a configurable OpenRouter model choice; the server offers the requested model IDs as examples. Provider availability and quality depend on credentials and service health.
- Knowledge ingestion and search, agent/Studio voice workflows, Plivo call/signature/DTMF/AMD handling, scheduled AI/audio campaigns, reusable saved campaign settings, retries, concurrency, pause/resume/cancel, variants and campaign queue counts.
- SMS bulk and individual queues, saved templates, inbound Plivo SMS, opt-out handling, knowledge-based automatic replies, message statuses, tagged audiences, and multi-step sequences with bulk and individual enrollment.
- Contacts with CSV import/export progress, tags, custom fields, scopes, history, and lead scoring. Individual SMS and full per-lead SMS history are available from the lead page.
- Call/report dashboards, webhook integrations and delivery history, KYC workflow, number request/approval inventory, billing ledger, the six listed payment-provider adapters, exchange-rate support and profit reporting.
- TOTP MFA, scoped roles/permissions, tenant-scoped database access, audit records, rate-limit helpers, secure password hashing (Argon2id), administrative controls, and a website widget.

## Partial, provider-dependent, or not yet fully verified

- Live carrier calls, SMS delivery, inbound SMS, transfer audio, AMD behavior and delivery receipts: Plivo code exists, but no carrier account/number is configured in this workspace. Do not treat these as carrier-tested.
- Voice under one second: the target is not met for the measured local pipeline; Hindi and model/network latency remain material.
- Per-call and per-campaign cost: app-side accounting/reporting exists, but carrier-rated cost reconciliation is not verified without carrier usage data.
- Broad advanced contact filtering and complete sequence analytics: some related flows/reports exist; this checklist needs a feature-by-feature UI/API acceptance pass.
- Language support: ten interface languages are selectable, but the current dictionary translates the navigation/shell only; page bodies are still primarily English. The “140+ pages translated” claim is not met.
- Payment gateways: adapters and webhook handlers exist, but each gateway still requires production credentials, configured webhook secrets, and live payment verification.
- Browser “WebRTC” calling: the live browser conversation uses the app’s audio/WebSocket path; a carrier-connected WebRTC softphone is not established.
- Plivo number search and rental are available in the staff inventory UI, but live purchase and carrier status behavior are not verified without Plivo credentials. Other carriers are unsupported.

## Not implemented in this codebase (or deliberately different)

- Twilio and Exotel carrier adapters, Twilio-only BYOC/SIP trunks and trunk health monitoring.
- An editable role/permission matrix; the six role bundles are defined in code.
- A general customer API-token management system equivalent to Sanctum; mobile/device and signed voice tokens serve narrower purposes.
- Automatic optimization of campaign send times; current call-time suggestions are historical answer-rate heuristics.
- Laravel Fortify, Sanctum, and bcrypt specifically: this is a TypeScript/Next.js application with custom auth, and it uses Argon2id for passwords.

## External checks still required

- Configure and test Plivo auth, a provisioned number, public callback URL, account KYC and destination permissions. Test inbound/outbound calls, SMS, transfer, opt-out, recording and callbacks on real devices.
- Test Plivo number search and rentals in the provider sandbox/account, including recurring fee confirmation and numbers pending compliance review.
- Migrations `0027_campaign_templates.sql` and `0028_pending_phone_numbers.sql` are applied to local `voiceai_dev`; apply them to other application databases before using those features there.
- Configure each chosen payment gateway and verify checkout, signed webhooks, idempotency, refunds/failures, currency conversion and ledger balances in sandbox before production.
- Configure production SMTP, object storage, embeddings/vector database, OpenRouter (if selected), and deployment infrastructure as needed.
- Run database integration tests with `TEST_DATABASE_URL` and `TEST_APP_DATABASE_URL`; the current local test run skips those without a configured test database.
