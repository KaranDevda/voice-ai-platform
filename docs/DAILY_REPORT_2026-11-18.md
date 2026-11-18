# Daily report: 18 Nov 2026

## Agenda
1. Admin pricing controls
2. Credit system with payment gateways
3. Investigation: human-like voices (Sarvam, ElevenLabs)

## 1. Admin pricing controls: done today
- **Per-country carrier cost + profit margin** (new). Profit page > *Pricing rules*. Staff enter what the carrier charges (call/min, text) and a margin %; selling price = cost + margin, rounded up so rounding never eats margin. Live preview as you type.
- **Apply margins** (new): one click sets an organisation's country prices to cost + margin for every country with a cost. Audited.
- **Profit report now costs each country at its own carrier cost** (falls back to the platform-wide cost), and shows a Margin % column by organisation, country and day.
- Already in place and verified: custom prices per country, CSV bulk import, manual credit adjustments/refunds with required note, profit dashboard (daily trend, by country, by organisation, CSV download).
- Code: `packages/shared/src/margin.ts`, `packages/db/src/pricing.ts`, migration `0043_carrier_margins.sql`, `/api/platform/carrier-costs`, `apps/web/components/profit-panel.tsx`.
- Tests: 6 new unit tests (margin maths) + 3 database tests (save, apply, validation, permissions). Full suite and typecheck pass.

## 2. Credit system with payment gateways: verified, one gap closed
- Pay-as-you-go ledger, six gateways (Stripe, PayPal, Razorpay, Paystack, Flutterwave, Cryptomus), signature-checked idempotent webhooks, multi-currency with exchange rates: all in the codebase; 150 provider tests pass.
- New today: Billing page shows balance with a **USD equivalent**.
- **Not done / honest limits:** no live gateway credentials in this workspace, so no live payment has been taken. The ledger is stored in INR paise (USD shown as a conversion, not stored in USD). Refund/chargeback automation not built.

## 3. Human-like voices: findings
- ElevenLabs: adapter already in the codebase (`packages/providers/src/elevenlabs.ts`, with tests).
- Sarvam: speech-to-text benchmarked on 3 Nov (1.0% character error, 0.26 s p50 on Hindi vs 19% for local Whisper); switch exists (`STT_HINDI=sarvam`), not enabled. **Sarvam text-to-speech is not integrated yet**: next step is a short listening comparison (same Hindi/Hinglish script through ElevenLabs, Sarvam, and our Pocket TTS clones), then a decision.
