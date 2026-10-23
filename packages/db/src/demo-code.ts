import { hotp, TOTP_STEP_S } from "@voiceai/auth";

// Prints the current 6-digit code for the shared demo 2FA secret (see seed-demo.ts).
const SECRET = "JBSWY3DPEHPK3PXP";
const now = Date.now() / 1000;
const remaining = TOTP_STEP_S - (Math.floor(now) % TOTP_STEP_S);
console.log(`${hotp(SECRET, Math.floor(now / TOTP_STEP_S))}   (valid for ${remaining}s; add the secret ${SECRET} to an authenticator app if you prefer)`);
