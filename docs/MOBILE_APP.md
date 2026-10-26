# Phones (Android and iPhone) and the dialer

Phase 3. What is built, how it works, and what it cannot do.

## What it does

- **Link a phone.** On the website, *Team & devices* > *Add a phone* shows a one-time code (8 characters, 10 minutes, works once). The person types it into the app. The phone gets a secret token, kept in the phone's secure keystore. The server keeps only a hash of the token and of the code.
- **Sync calls (Android).** The app reads the call history of the **work SIM only** and uploads new calls. Calls on the personal SIM are filtered out on the phone and never leave it. A number that is not yet a lead becomes one (consent unknown), so no call is lost.
- **Offline queue.** Calls are written to the phone's storage first and removed only after the server has answered for them. A dropped connection, a crash or a closed app loses nothing, and sending a call twice saves it once (the server remembers each call by device and local id). Retries back off from 5 seconds to 15 minutes.
- **Check before calling.** The app (and the web dialer) asks the server whether a number may be called: Do Not Disturb, withdrawn or denied consent, and the calling hours (default 9am to 9pm India time). The answer is the same one the AI follows. A blocked attempt is written to the audit log.
- **iPhone.** Apple does not let any app read call history, so iPhones do not sync calls automatically. The iPhone app links, shows the rules, checks a number, opens the dialler, and the person logs how the call went.
- **Revoking.** *Revoke* on Team & devices stops that phone at once (its next request is refused); suspending the person does the same. Pairing the same phone again with a fresh code brings it back as the same device, with a new token.
- **Web dialer.** *Me* mode: the server checks the number, then a `tel:` link opens the person's own phone app; afterwards they log the outcome and duration, and it appears in Call logs and on the lead. *AI assistant* mode: opens a practice call in the browser (you play the lead) that follows the same outbound rules and is saved to the call logs.

## Where things are

| Part | Location |
|---|---|
| Pairing, device sign-in, sync, checks (database) | `packages/db/src/mobile.ts`, migrations `0005`, `0006` |
| Request shapes shared by app and server | `packages/shared/src/mobile.ts` |
| Server routes | `apps/web/app/api/mobile/*`, `apps/web/app/api/calls/{check,log}` |
| App logic: API client, offline queue, call-log mapping (tested) | `packages/mobile-core` |
| The app (Expo, React Native) | `apps/mobile` (outside the pnpm workspace) |

A phone has no browser session, so `/api/mobile/*` is open to the session middleware and each route checks the device token itself (`Authorization: Bearer vd_...`). Looking up a token or claiming a code before the organisation is known goes through two narrow `SECURITY DEFINER` functions (`auth_find_device`, `auth_claim_pairing_code`), the same pattern as login. Grant them to the application role at deploy time. Pairing attempts are limited to 10 per 10 minutes per address.

## Running the app

The app needs a development build, not Expo Go, because reading the call log uses a native module.

```bash
cd apps/mobile
pnpm install --ignore-workspace
EXPO_PUBLIC_API_URL=http://<your computer's address>:3000 pnpm android   # or: pnpm ios
```

A phone on the same Wi-Fi reaches the website at your computer's address, not `localhost`. Then: website > Team & devices > Add a phone, and type the code into the app. On Android, choose the work SIM and allow call history. Every check the app depends on is tested without a phone: `pnpm --filter @voiceai/mobile-core test`.

## What is not built, or not tested

- **The app has not been run on a real phone or emulator.** It passes type checking and bundles for both platforms, and its sync logic is covered by tests, but nobody has tapped through it. Expect small fixes on the first real run, especially the Android work-SIM choice (phone makers report SIM ids differently) and permissions.
- **Background sync is built but unproven.** While closed, the system runs a sync task about every 15 minutes (it decides, and does so less often on low battery). Whether it actually fires on a given phone is only known by testing on that phone; some makers (Xiaomi, Oppo, Vivo) stop background tasks unless the person excludes the app from battery saving.
- **Call recordings.** Not uploaded. Android 10 and later limit what an app can record, and uploads need the storage (S3) from phase 5.
- **The company phone line.** Calls to real numbers by the AI need the carrier (waiting on the KYC decision). Until then the dialer uses the person's own phone, and AI calls are browser practice calls.
- **Store release.** No app icon, signing, or Play Store / App Store setup. iOS builds need an Apple developer account and a Mac with Xcode.
- **Notifications** (new-device alerts, hand-over pushes). A newly linked phone shows on Team & devices and is audited.
- Rate limits: pairing is limited to 10 tries per 10 minutes per address, and each phone to 120 requests a minute. Both counters live in server memory, so they reset on restart and are per server.
