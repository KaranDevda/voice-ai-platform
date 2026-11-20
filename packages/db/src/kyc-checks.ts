/**
 * Offline checks for Indian PAN and GSTIN numbers. They catch typos, invented numbers and a PAN that does not belong to the
 * GSTIN. They cannot prove that a number belongs to a real person or company: only the Income Tax Department and the GST
 * Network can say that (see the KYC page notes), so a person at the platform still reviews every request.
 */

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
/** The 4th letter of a PAN says what kind of holder it is. */
const PAN_HOLDER = new Set(["A", "B", "C", "F", "G", "H", "J", "K", "L", "P", "T"]);
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
/** State and union-territory codes the GST system uses (01-38), plus 97 (other territory) and 99 (centre jurisdiction). */
const isStateCode = (code: string) => { const n = Number(code); return (n >= 1 && n <= 38) || n === 97 || n === 99; };
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The 15th character of a GSTIN, computed from the first 14. */
export function gstinCheckChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = ALPHABET.indexOf(first14[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36]!;
}

/** Returns what is wrong with the PAN, or null when it passes the offline checks. */
export function checkPan(pan: string): string | null {
  if (!PAN.test(pan)) return "the PAN looks wrong (5 letters, 4 digits, 1 letter, like ABCDE1234F)";
  if (!PAN_HOLDER.has(pan[3]!)) return "the PAN is not valid: its 4th letter must be one of A, B, C, F, G, H, J, K, L, P, T";
  return null;
}

/** Returns what is wrong with the GSTIN (and, when given, whether it matches the PAN), or null when it passes. */
export function checkGstin(gstin: string, pan?: string): string | null {
  if (!GSTIN.test(gstin)) return "the GSTIN looks wrong (15 characters, like 27ABCDE1234F1Z5)";
  if (!isStateCode(gstin.slice(0, 2))) return "the GSTIN starts with a state code that does not exist";
  if (gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) return "the GSTIN is not valid: its last character does not match the rest (check for a typing mistake)";
  if (pan && gstin.slice(2, 12) !== pan) return "the GSTIN does not belong to this PAN: characters 3 to 12 of a GSTIN are the PAN";
  return null;
}

// ----------------------------------------------------------------------------------------------- documents

export const KYC_DOC_MAX_BYTES = 2 * 1024 * 1024;
export type KycDocKind = "pan" | "gst";

/** What the file really is, from its first bytes (the name and the browser's type can be anything). Null when it is not a PDF, PNG or JPEG. */
export function sniffDocument(b: Uint8Array): { mime: "application/pdf" | "image/png" | "image/jpeg"; ext: string } | null {
  if (b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return { mime: "application/pdf", ext: "pdf" };
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  return null;
}
