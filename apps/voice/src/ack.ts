/**
 * A short acknowledgement played the moment the caller's words are final, while the AI is still working out the answer.
 * It is not part of the conversation history: the system prompt tells the model the caller already heard one.
 * The audio is made once per voice and kept (see primeAck in pipeline.ts), so it plays at once even in a staff voice that takes
 * seconds to make a sentence. `fastHindi` is false only for a voice where Hindi cannot be cached.
 */
const SKIP = /^(hi|hello|hey|thanks?|thank you|bye|goodbye|ok|okay|yes|no|yeah|yep|sure|please|sorry|hmm|namaste|namaskar|नमस्ते|धन्यवाद|शुक्रिया|ठीक|हाँ|हां|नहीं|जी|अच्छा|ओके|बाय)(\s|$|[.,!?।])/i;
const QUESTION = /^(what|how|why|when|where|who|which|do|does|did|is|are|was|were|will|has|have)\b/i;
const REQUEST = /^(can|could|would|may|please|i'?d like|i would like|i want|i need|i'?m looking|tell me|show me|give me|let me|book|schedule|arrange|send|call|connect)\b|\b(can you|could you|would you|please)\b/i;
const DEVANAGARI = /[ऀ-ॿ]/;
const HINDI_ASK = /\?|क्या|कितना|कितनी|कितने|कौन|कैसे|कब|कहाँ|कहां|क्यों|बताइए|बताओ|बताएं|चाहिए|चाहता|चाहती|कर दीजिए|करवा/;

/**
 * Only a real question or request earns an acknowledgement. Statements (a name, a date, "that works for me"), greetings, thanks
 * and short replies get none, because "Sure." after "My name is Karan" sounds wrong. Questions get "Let me check.", requests "Sure.".
 */
/** Greetings, thanks and short replies: no acknowledgement, and no "one moment" even when the AI is slow. */
export const isSmallTalk = (userText: string): boolean => userText.trim().split(/\s+/).length < 4 || SKIP.test(userText.trim());

export function ackFor(userText: string, language: "en" | "hi" | "en-hi", fastHindi = false): string | null {
  const text = userText.trim();
  if (isSmallTalk(text)) return null;
  if (language === "hi" || DEVANAGARI.test(text)) return fastHindi && HINDI_ASK.test(text) ? "जी।" : null;
  if (REQUEST.test(text)) return "Sure.";
  return text.endsWith("?") || QUESTION.test(text) ? "Let me check." : null;
}
