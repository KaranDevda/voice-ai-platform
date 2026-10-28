/**
 * A short acknowledgement played the moment the caller's words are final, while the AI is still working out the answer.
 * It is not part of the conversation history: the system prompt tells the model the caller already heard one.
 * Hindi gets one only when the voice is fast in Hindi (ElevenLabs, first sound about 0.3 s): the built-in Hindi voice takes
 * about 1.6 s per sentence, so an acknowledgement would arrive after the answer and only delay it.
 */
const SKIP = /^(hi|hello|hey|thanks?|thank you|bye|goodbye|ok|okay|yes|no|yeah|yep|sure|please|sorry|hmm|namaste|namaskar|नमस्ते|धन्यवाद|शुक्रिया|ठीक|हाँ|हां|नहीं|जी|अच्छा|ओके|बाय)(\s|$|[.,!?।])/i;
const QUESTION = /^(what|how|why|when|where|who|which|can|could|do|does|is|are|will|would)\b/i;
const DEVANAGARI = /[ऀ-ॿ]/;

export function ackFor(userText: string, language: "en" | "hi" | "en-hi", fastHindi = false): string | null {
  const text = userText.trim();
  if (text.split(/\s+/).length < 4 || SKIP.test(text)) return null;
  if (language === "hi" || DEVANAGARI.test(text)) return fastHindi ? "जी।" : null;
  return text.endsWith("?") || QUESTION.test(text) ? "Sure." : "Okay.";
}
