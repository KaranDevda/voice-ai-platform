# Phones (Android and iPhone) and the dialer

Phase 3. What is built, how it works, and what it cannot do.

## Privacy: sharing is off until the person turns it on
A phone's call history is personal data, so the app shares **nothing by default**. After linking, the person must (1) allow call history, (2) choose the work SIM, and (3) press **Turn on sharing**, which shows exactly what is and is not sent and asks them to confirm.
- **Sent:** the number, time, length and direction of calls on the work SIM, **from the moment sharing was turned on**. Never earlier calls.
- **Never sent:** calls on other SIMs, messages or chats, contacts, anything else on the phone. The app has no permission to read them.
- **Stopping:** *Turn off sharing* stops reading and discards anything waiting. *Stop sharing and delete everything I uploaded* asks the server to delete the phone's calls, its recordings, the leads only that phone created, and the phone's record (`DELETE /api/mobile/me`, audited with counts only). *Unlink this phone* also clears sharing on the phone.
- **Choosing the SIM** reads the 30 most recent calls on the phone only to list the SIM labels. Nothing is sent.
- The phone app is meant for a **company work phone** with a work SIM, not a personal phone.

## What it does

- **Link a phone.** On the website, *Team & devices* > *Add a phone* shows a one-time code (8 characters, 10 minutes, works once). The person types it into the app. The phone gets a secret token, kept in the phone's secure keystore. The server keeps only a hash of the token and of the code.
- **Sync calls (Android).** Once sharing is on, the app reads the call history of the **work SIM only** and uploads new calls. Calls on the personal SIM are filtered out on the phone and never leave it. A number that is not yet a lead becomes one (consent unknown), so no call is lost.
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
- **Call recordings: the server side is built and tested; the app side is not.** A phone can upload the recording of one of its own calls (`POST /api/mobile/calls/<id>/recording`, audio up to 50 MB, once per call, audited), and a signed-in person with access to the call can play it. Files are kept in a private folder on the server (`RECORDINGS_DIR`); moving to encrypted S3 with 5-minute links changes only `apps/web/lib/recording-store.ts`. The app cannot record calls itself (Android 10 and later forbid it); it can only upload what the phone's own call recorder saved. `packages/mobile-core/src/recordings.ts` pairs each call with its recording by time and by the number in the file name (tested). Wiring it into the app needs the media-library permission and a rebuild, so it waits until the base app is confirmed working on a phone.
- **The company phone line.** Calls to real numbers by the AI need the carrier (waiting on the KYC decision). Until then the dialer uses the person's own phone, and AI calls are browser practice calls.
- **Store release: prepared, not done.** Icon (soft placeholder), splash, version numbers and build profiles exist; accounts, the real icon, the HTTPS server address and, for Google Play, approval to read the call log are listed in `apps/mobile/RELEASE.md`. For company staff, a private build avoids the Play review.
- **Notifications** (new-device alerts, hand-over pushes). A newly linked phone shows on Team & devices and is audited.
- Rate limits: pairing is limited to 10 tries per 10 minutes per address, and each phone to 120 requests a minute. Both counters live in server memory, so they reset on restart and are per server.
