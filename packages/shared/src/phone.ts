import { parsePhoneNumberFromString } from "libphonenumber-js";

/** Normalises to E.164; bare national numbers are assumed to be Indian. Returns null if invalid. */
export function normalizePhone(raw: string, defaultCountry: "IN" = "IN"): string | null {
  const parsed = parsePhoneNumberFromString(raw.trim(), defaultCountry);
  return parsed?.isValid() ? parsed.format("E.164") : null;
}

/** Masks a number for roles without leads.pii.read, e.g. +919876543123 -> 98XXXXX123. */
export function maskPhone(e164: string): string {
  const national = e164.replace(/\D/g, "").slice(-10);
  if (national.length < 6) return "X".repeat(national.length);
  return `${national.slice(0, 2)}${"X".repeat(national.length - 5)}${national.slice(-3)}`;
}
