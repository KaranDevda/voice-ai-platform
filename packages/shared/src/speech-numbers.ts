/**
 * Makes names, numbers and rupee amounts safe to hand to a voice. A voice reads "98765 43210" as one huge number and "₹4,999" as
 * a symbol, so this writes them out the way a person would say them, in English or in Hindi (when the text has Devanagari).
 *   phone numbers, OTPs and PINs  -> digit by digit, in groups ("nine eight seven six five, four three two one zero")
 *   ₹ / Rs. / INR amounts         -> words in the Indian system ("twelve lakh fifty thousand rupees")
 *   Indian-comma numbers          -> words (12,50,000)
 *   e-mail addresses              -> "rohan at bizfy dot in"
 */
const EN_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const HI_DIGITS = ["शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ"];

/** 0 to 99 as English words. */
const below100 = (n: number) => (n < 20 ? EN_ONES[n]! : EN_TENS[Math.floor(n / 10)]! + (n % 10 ? `-${EN_ONES[n % 10]}` : ""));
const below1000 = (n: number) => (n >= 100 ? `${EN_ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${below100(n % 100)}` : ""}` : below100(n));

/** A whole number in English words using lakh and crore (the way Indian speakers say it). */
export function englishIndianWords(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n >= 1e14) return String(n);
  if (n === 0) return "zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7), lakh = Math.floor((n % 1e7) / 1e5), thousand = Math.floor((n % 1e5) / 1e3), rest = n % 1e3;
  if (crore) parts.push(`${crore >= 100 ? englishIndianWords(crore) : below100(crore)} crore`);
  if (lakh) parts.push(`${below100(lakh)} lakh`);
  if (thousand) parts.push(`${below100(thousand)} thousand`);
  if (rest) parts.push(below1000(rest));
  return parts.join(" ");
}

const digitWords = (digits: string, hindi: boolean) => [...digits].map((d) => (hindi ? HI_DIGITS : EN_ONES)[Number(d)]!).join(" ");

/** Digits spoken one by one in groups of up to 5, a comma between groups so the voice pauses: 9876543210 -> "nine eight seven six five, four three two one zero". */
function spokenDigits(digits: string, hindi: boolean): string {
  const groups = digits.length === 10 ? [digits.slice(0, 5), digits.slice(5)] : digits.length > 6 ? digits.match(/.{1,4}/g)! : [digits];
  return groups.map((g) => digitWords(g, hindi)).join(", ");
}

export function speakableNumbers(text: string): string {
  const hindi = /[ऀ-ॿ]/.test(text);
  return text
    // e-mail addresses
    .replace(/\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\b/g, (_m, user: string, host: string) => `${user.replace(/[._-]/g, " ")} ${hindi ? "एट" : "at"} ${host.split(".").join(hindi ? " डॉट " : " dot ")}`)
    // phone numbers: +91 / 0 prefix, 10 digits, optional space or dash after the fifth digit
    .replace(/(?<![\d,.])(?:\+?91[\s-]?|0)?([6-9]\d{4})[\s-]?(\d{5})(?![\d,]|\.\d)/g, (_m, a: string, b: string) => spokenDigits(a + b, hindi))
    // OTP, PIN, code, ID and order numbers: the number right after the word is read digit by digit
    .replace(/\b(OTP|PIN|code|ID|order(?: number)?|ओटीपी|पिन|कोड|आईडी)\b(\s*(?:is|:|है|-|#)?\s*)(\d{4,8})(?![\d,])/gi, (_m, word: string, sep: string, d: string) => `${word}${sep}${spokenDigits(d, hindi)}`)
    // rupee amounts, English only (the Hindi path has its own): ₹4,999 / Rs. 12,50,000 / INR 1.5 lakh
    .replace(hindi ? /$^/ : /(?:₹|Rs\.?|INR)\s*(\d[\d,]*)(?:\.(\d{1,2}))?(?!\d)(\s*(?:lakh|lakhs|crore|crores|thousand|k)\b)?/gi, (_m, whole: string, paise: string | undefined, unit: string | undefined) => {
      const n = Number(whole.replace(/,/g, ""));
      if (unit) return `${paise ? `${englishIndianWords(n)} point ${digitWords(paise, false)}` : englishIndianWords(n)}${unit} rupees`;
      return `${englishIndianWords(n)} rupees${paise ? ` and ${englishIndianWords(Number(paise.padEnd(2, "0")))} paise` : ""}`;
    })
    // other numbers written with Indian commas (12,50,000) or western commas with 4+ digits, English only
    .replace(hindi ? /$^/ : /(?<![\d,.])\d{1,3}(?:,\d{2})*,\d{3}(?![\d,]|\.\d)/g, (m) => englishIndianWords(Number(m.replace(/,/g, ""))));
}
