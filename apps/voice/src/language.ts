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

const NOTE: Record<CallerLanguage, string> = { en: "English", hi: "Hindi", hinglish: "Hinglish" };

/**
 * The language tag for this turn. English is the default, so English that continues English needs none (every token sent fresh
 * costs the caller time); Hindi and Hinglish are tagged every turn, and English right after them is tagged to switch back.
 */
export function languageNote(current: string, previous?: string, session: "en" | "hi" | "en-hi" = "en-hi"): string {
  // The language chosen for the call is final: English and Hindi calls never follow the words the caller happens to use.
  if (session === "en") return "";
  if (session === "hi") return `reply language: ${NOTE.hi}`;
  const before = previous ? detectCallerLanguage(previous) : undefined;
  const now = detectCallerLanguage(current) ?? before ?? "en";
  return now === "en" && (before ?? "en") === "en" ? "" : `reply language: ${NOTE[now]}`;
}

/**
 * A standing rule for the whole call, from the language chosen when it started. It goes in the system prompt (which the model
 * keeps a saved copy of), so it costs nothing per turn. A mixed English-and-Hindi call has none: the caller's own words decide.
 */
export function sessionLanguageRule(session: "en" | "hi" | "en-hi"): string {
  if (session === "en") return "\n\nThis call is in English. Every reply must be in English only: no Hindi words and no Devanagari, even if the caller uses a Hindi word such as 'namaste' or 'haan'. Answer such a caller in plain English. If the caller asks you to speak Hindi, say in English that this call is in English and offer to help in English.";
  if (session === "hi") return "\n\nThis call is in Hindi. Every reply must be in Hindi only, written in Devanagari, even if the caller uses an English word. Only product names such as Business plan may stay in English letters.";
  return "";
}

const DEVANAGARI = /[ऀ-ॿ]/;

/** True when a spoken sentence is in the wrong language for an English or Hindi call (a mixed call accepts anything). */
export function wrongLanguage(sentence: string, session: "en" | "hi" | "en-hi"): boolean {
  if (session === "en") return DEVANAGARI.test(sentence);
  if (session === "hi") return !DEVANAGARI.test(sentence) && (sentence.match(/[A-Za-z]{2,}/g) ?? []).length >= 3;
  return false;
}

/** A one-line reminder added to the caller's message when the first answer came back in the wrong language. */
export function strictNote(session: "en" | "hi" | "en-hi"): string {
  return session === "hi" ? "[note: reply in Hindi only, written in Devanagari]" : "[note: reply in English only, with no Hindi words]";
}

/** What to say if the model keeps answering in the wrong language. */
/** Said when the AI has not started answering after a few seconds, so the caller knows the call is alive. */
export function stillWorking(session: "en" | "hi" | "en-hi"): string {
  return session === "en" ? "I’m still here with you." : session === "hi" ? "जी, मैं सुन रहा हूँ।" : "हाँ, मैं सुन रहा हूँ।";
}

/** Said when AskG1 did not start answering in time: nothing is wrong with the call, the caller is invited to ask again (no hand-over). */
export function askAgainSlow(session: "en" | "hi" | "en-hi"): string {
  return session === "en" ? "Sorry, that is taking longer than usual. Could you ask me again?" : "माफ़ कीजिए, जवाब आने में देर हो रही है। क्या आप दोबारा पूछ सकते हैं?";
}

export function sorryAgain(session: "en" | "hi" | "en-hi"): string {
  return session === "hi" ? "माफ़ कीजिए, क्या आप दोबारा बता सकते हैं?" : "Sorry, could you say that again?";
}

/**
 * "Hello" or "Hi" is the greeting on English and Hinglish calls, never "Namaste" (the model still writes it now and then, even when
 * told not to). Swapped in the text itself, before it is spoken, so it costs no time. A Hindi call keeps "नमस्ते".
 */
export function greetingFix(text: string, session: "en" | "hi" | "en-hi"): string {
  if (session === "hi") return text;
  return text.replace(/\b(?:namaste|namaskar)\b/gi, "Hello").replace(/नमस्ते|नमस्कार/g, "Hello");
}
