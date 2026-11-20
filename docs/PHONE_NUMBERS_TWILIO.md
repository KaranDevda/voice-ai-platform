# Twilio numbers, SIP trunks (BYOC) and trunk health

Set `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` on the web server (see `.env.example`). Without them the Twilio carrier option errors with "provider_not_configured" and the SIP trunk card is hidden (the trunk API answers `409 twilio_only`).

## Numbers
- Staff: Platform → "Search and rent a number" → choose **Twilio**. Search uses Twilio's AvailablePhoneNumbers (Local / TollFree / Mobile) and its pricing API for the monthly price. Renting re-checks the price, then buys with `IncomingPhoneNumbers`. Countries with regulations need an Address SID (`AD…`) or Bundle SID (`BU…`).
- Numbers carry a `carrier` (`plivo` default, `twilio`). Request → approve → assign works the same for both.
- **Use today:** campaign caller IDs are limited to Plivo numbers (the voice service only dials through Plivo). SMS goes out from `PLIVO_SMS_SENDER`. There is no browser softphone. The Numbers page says so next to each number.

## SIP trunks (BYOC)
Numbers page → "Add a SIP trunk": name, **your SIP address** (inbound: `sip:` / `sips:`, public host only), and for outbound a **PBX IP** (allow-listed /32) and/or a **SIP login** (12+ chars with upper, lower, digit). We create the Twilio Elastic SIP trunk, a unique `*.pstn.twilio.com` termination domain, the origination URL, and the ACL/credential list; nothing is left behind at Twilio if a step fails. Up to 5 trunks per organisation. Attach/detach a Twilio number to route it through the trunk.

API (all org-scoped, `org_settings.read` to view, `org_settings.write` to change): `GET/POST /api/trunks`, `DELETE /api/trunks/:id`, `POST /api/trunks/:id/health`, `POST /api/trunks/:id/numbers {numberId, attach}`.

## Health
`POST /api/trunks/:id/health` reads the live trunk, tests each enabled SIP endpoint with a TCP connect (addresses resolving to private ranges are never probed), counts failed/busy/no-answer calls of the last 24 hours, and returns `ok | degraded | down` with one line per check (`computeTrunkHealth`, a pure, unit-tested function). Down: trunk deleted at Twilio, no SIP endpoint reachable, or ≥50% of ≥10 calls failed. Degraded: no outbound auth, no enabled origination URL, no numbers, some endpoints unreachable, or ≥20% failures. A TCP connect proves a port answers, not that the PBX speaks SIP correctly.

## Not verified
Nothing here has run against a real Twilio account: the adapter follows Twilio's documented REST shapes and is tested with mocked responses (`packages/providers/src/twilio.test.ts`). First live run may need small field fixes. `verifyTwilioSignature` (X-Twilio-Signature) is ready for a Twilio webhook handler, which does not exist yet. No scheduled health monitor or alerts yet.
