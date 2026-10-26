export type CallerLanguage = "en" | "hi" | "hinglish";

/** Hindi words written in English letters. Only words that are not ordinary English belong here. */
const HINGLISH_WORDS = new Set([
  "kaise", "kaisa", "kaisi", "aap", "aapka", "aapki", "aapko", "aapke", "hai", "hain", "nahi", "nahin", "kya", "kyun", "kyu", "mujhe", "mera", "meri", "mere", "hum", "humein",
  "batao", "bataiye", "bataye", "batana", "karo", "kare", "karte", "karta", "karti", "karna", "kijiye", "chahiye", "chahta", "chahti", "chahte", "theek", "thik", "accha", "achha",
  "bahut", "abhi", "kitna", "kitne", "kitni", "kab", "kahan", "kaun", "haan", "dhanyavad", "shukriya", "namaste", "bhai", "yaar", "paise", "wala", "wali", "lekin", "toh", "kuch",
  "mein", "ke", "ka", "ki", "se", "par", "baare", "baat", "samajh", "samjha", "sakta", "sakte", "sakti", "milega", "milta", "milti", "liye", "pehle", "baad", "bilkul", "zaroor",
]);
// "ke", "ka", "ki", "se", "par", "mein" are ordinary in Hinglish but also appear in English names; they only count together with another marker.
const WEAK = new Set(["ke", "ka", "ki", "se", "par", "mein", "hum", "toh", "lekin", "aur", "wala", "wali", "liye", "baad", "pehle"]);

/**
 * What language the caller is using, from how they wrote it (the speech recogniser writes Hindi in Devanagari, English
 * words in English letters, and Hinglish as a mix). A short reply with no evidence ("okay", "thanks") returns undefined
 * so the caller's previous language carries on.
 */
export function detectCallerLanguage(text: string): CallerLanguage | undefined {
  const devanagari = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  const latinWords = text.match(/[A-Za-z]{2,}/g) ?? [];
  if (devanagari) return latinWords.length >= 2 ? "hinglish" : "hi";
  const lower = latinWords.map((w) => w.toLowerCase());
  const strong = lower.filter((w) => HINGLISH_WORDS.has(w) && !WEAK.has(w));
  const weak = lower.filter((w) => WEAK.has(w));
  if (strong.length >= 1 && (strong.length + weak.length >= 2 || lower.length <= 3)) return "hinglish";
  if (strong.length >= 2) return "hinglish";
  return lower.length <= 2 ? undefined : "en";
}

const NOTE: Record<CallerLanguage, string> = {
  en: "The caller is speaking English. Reply in English only, with no Hindi words.",
  hi: "The caller is speaking Hindi. Reply in Hindi only, written in Devanagari script. Never write Hindi in English letters. Short English product names such as Business plan may stay in English letters.",
  hinglish: "The caller is speaking Hinglish. Reply in natural Hinglish, the way an Indian customer-care executive talks. Write every Hindi word in Devanagari script, for example आपकी मदद, never aapki madad. Only real English words such as plan, call recording or thanks stay in English letters. Never mix the two scripts inside one word. Example: जी, Business plan की कीमत 4,999 रुपये प्रति माह है।",
};

/** A line added to the instruction for this turn, so the model answers in the language the caller just used. */
export function languageNote(current: string, previous?: string): string {
  const now = detectCallerLanguage(current) ?? (previous ? detectCallerLanguage(previous) : undefined) ?? "en";
  return `\n\n${NOTE[now]}`;
}
