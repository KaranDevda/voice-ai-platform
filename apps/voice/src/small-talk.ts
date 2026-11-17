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
  let normalized = text.normalize("NFC").toLowerCase().replace(/[.,!?؟।]+/gu, " ").replace(/\s+/gu, " ").trim();
  // Whisper occasionally prefixes a clean greeting with a stray fragment such as "who Hi, how are you?".
  // Only trim it when the remainder still matches one of the exact greeting patterns below.
  normalized = normalized.replace(/^(?:(?:who|uh|um|well|yeah|yes|so)\s+)+(?=(?:hi|hello|hey|good morning|good afternoon|good evening|नमस्ते|नमस्कार|हेलो|हाय|namaste|namaskar)(?:\s|$))/iu, "");
  // Hindi Whisper can repeat a greeting or add short scraps like "कर दो" / "अब". Accept this only when
  // every recognized word is still part of a greeting, so a real question after the greeting is never discarded.
  const hindiGreeting = /(?:नमस्ते|नमस्कार|हेलो|हाय)/u.test(normalized);
  const hindiHow = /(?:कैसे|कैसी)\s+(?:हैं|है|हो)\s*(?:आप)?/u.test(normalized);
  const hindiGreetingOnlyWords = new Set(["नमस्ते", "नमस्कार", "हेलो", "हाय", "कैसे", "कैसी", "हैं", "है", "हो", "आप", "अब", "कर", "दो"]);
  if (hindiGreeting && hindiHow && normalized.split(/\s+/u).every((word) => hindiGreetingOnlyWords.has(word))) return "greeting-and-how";
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

/** A clipped transcript is better handled by asking for the missing question than by sending a fragment to the LLM. */
export function replyToOrphanedPlanFragment(text: string, callLanguage: CallLanguage): string | null {
  const normalized = text.normalize("NFC").toLowerCase().replace(/[.,!?؟।]+/gu, " ").replace(/\s+/gu, " ").trim();
  const english = /^(?:(?:through|with|of|from|to|for|because|and|but)\s+)+(?:the\s+)?(?:business|starter|enterprise)\s+plans?$/iu.test(normalized);
  if (!english) return null;
  if (callLanguage === "hi") return "माफ़ कीजिए, आपकी बात का आख़िरी हिस्सा ही सुनाई दिया। Business plan के बारे में क्या जानना चाहेंगे?";
  if (callLanguage === "en-hi") {
    const lang = detectCallerLanguage(text);
    if (lang === "hi") return "माफ़ कीजिए, आपकी बात का आख़िरी हिस्सा ही सुनाई दिया। Business plan के बारे में क्या जानना चाहेंगे?";
    if (lang === "hinglish") return "Sorry, आपकी बात का last part ही सुनाई दिया। Business plan के बारे में क्या जानना चाहेंगे?";
  }
  return "Sorry, I only caught the end of that. What would you like to know about the Business plan?";
}
