import { detectCallerLanguage } from "./language";

type CallLanguage = "en" | "hi" | "en-hi";

const EN_GREETING = "(?:hi|hello|hey|good morning|good afternoon|good evening)(?: there)?";
const HI_GREETING = "(?:नमस्ते|नमस्कार|हेलो|हाय)";
const LATIN_GREETING = "(?:namaste|namaskar)";
const EN_HOW = "(?:how are you(?: doing)?(?: today)?|how'?s it going(?: today)?|how are things(?: today)?)";
const HI_HOW = "(?:आप कैसे हैं|आप कैसी हैं|आप कैसे हो|आप कैसी हो|कैसे हैं|कैसी हैं|कैसे हो|कैसी हो)";
const LATIN_HOW = "(?:(?:aap )?(?:kaise|kaisi) (?:ho|hain)(?: aap)?|how are you)";
const GREETING = `(?:${EN_GREETING}|${HI_GREETING}|${LATIN_GREETING})`;
const HOW = `(?:${EN_HOW}|${HI_HOW}|${LATIN_HOW})`;
const greetOnly = new RegExp(`^${GREETING}$`, "iu");
const howOnly = new RegExp(`^${HOW}$`, "iu");
const greetAndHow = new RegExp(`^${GREETING}\\s+${HOW}$`, "iu");
const IDENTITY_QUESTION = /^(?:what are you|who are you|are you (?:an ai|a person|human)|am i speaking to an ai)[.!?]*$/iu;

type GreetingKind = "greeting" | "how" | "greeting-and-how";

function greetingKind(text: string): GreetingKind | null {
  const normalized = text.normalize("NFC").toLowerCase().replace(/[.,!?؟।]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (greetAndHow.test(normalized)) return "greeting-and-how";
  if (greetOnly.test(normalized)) return "greeting";
  if (howOnly.test(normalized)) return "how";
  return null;
}

function responseLanguage(text: string, callLanguage: CallLanguage, previous?: string): "en" | "hi" | "hinglish" {
  if (callLanguage === "en") return "en";
  if (callLanguage === "hi") return "hi";
  const detected = detectCallerLanguage(text) ?? (previous ? detectCallerLanguage(previous) : undefined);
  return detected ?? "en";
}

/** Replies to greetings without waiting for a model, while leaving substantive questions to the normal conversation path. */
export function replyToGreeting(text: string, callLanguage: CallLanguage, previous?: string): string | null {
  const kind = greetingKind(text);
  if (!kind) return null;

  const language = responseLanguage(text, callLanguage, previous);
  if (language === "hi") {
    if (kind === "greeting") return "नमस्ते! बताइए, मैं आपकी क्या मदद करूँ?";
    if (kind === "greeting-and-how") return "नमस्ते! मैं ठीक हूँ, धन्यवाद। बताइए, मैं आपकी क्या मदद करूँ?";
    return "मैं ठीक हूँ, धन्यवाद। बताइए, मैं आपकी क्या मदद करूँ?";
  }
  if (language === "hinglish") {
    if (kind === "greeting") return "Hi! बताइए, मैं आपकी कैसे help करूँ?";
    if (kind === "greeting-and-how") return "Hi! मैं ठीक हूँ, thank you. बताइए, मैं आपकी कैसे help करूँ?";
    return "मैं ठीक हूँ, thank you. बताइए, मैं आपकी कैसे help करूँ?";
  }

  const normalized = text.toLowerCase();
  const salutation = normalized.includes("good morning") ? "Good morning"
    : normalized.includes("good afternoon") ? "Good afternoon"
      : normalized.includes("good evening") ? "Good evening"
        : "Hi";
  if (kind === "greeting") return `${salutation}! How can I help you today?`;
  if (kind === "greeting-and-how") return `${salutation}! I'm doing well, thank you. How can I help you today?`;
  return "I'm doing well, thank you. How can I help you today?";
}

/** Keeps the assistant's identity answer truthful and consistent instead of relying on the model to improvise it. */
export function replyToIdentityQuestion(text: string, callLanguage: CallLanguage): string | null {
  if (callLanguage !== "en" || !IDENTITY_QUESTION.test(text.normalize("NFC").trim())) return null;
  return "I'm Bizfy's AI voice assistant. I can help with our plans and services.";
}
