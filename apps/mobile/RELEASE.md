# Releasing the phone app

What is ready: app name, bundle ids (`com.bizfylabs.voiceai`), version numbers, icon and splash (placeholders, see below), and the build
profiles in `eas.json`. What needs an account or a decision is listed here, because nobody can do it from the code.

## Before the first store build
1. **Real icon.** `assets/icon.png` is the 302 px Bizfy mark stretched to 1024 px, so it is soft. Replace `icon.png`, `adaptive-icon.png`
   (logo on a transparent background, with a safe margin) and `splash-icon.png` with 1024 px artwork from the brand files.
2. **Server address.** Replace `REPLACE-WITH-YOUR-SERVER` in `eas.json` with the real HTTPS address of the platform. Release builds must
   use HTTPS; the phone refuses plain `http` outside development.
3. **Accounts.** An Expo account (free) for cloud builds; a Google Play Console account ($25 once); an Apple Developer account ($99 a year).

## Google Play: the call-log permission needs approval
Google restricts `READ_CALL_LOG`. A normal app that asks for it is rejected unless Google approves a **Permissions Declaration** in Play
Console explaining the use ("call log is core functionality: syncing company calls to the company CRM"), with a public privacy policy
that says what is read (work-SIM calls only), where it goes, and how it is deleted. Approval can take days and can be refused.
**Simpler for a company's own staff:** do not publish publicly. Use an internal build (`eas build --profile preview`) installed by file,
or a *private app* in managed Google Play. Private distribution avoids the declaration review.

## Apple
iPhones cannot read call history, so the iOS app only links, checks numbers and logs calls by hand. It uses no restricted permission.
App Store review needs a privacy policy URL and a test account the reviewers can use.

## Build commands (after the steps above)
```
pnpm dlx eas-cli login
pnpm dlx eas-cli build --platform android --profile preview      # installable file for staff
pnpm dlx eas-cli build --platform all --profile production       # store builds
```
