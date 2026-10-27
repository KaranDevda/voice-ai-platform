export type Gender = "male" | "female";

/**
 * In Hindi a speaker's verbs and adjectives change with their gender ("मैं कर सकता हूँ" for a man, "मैं कर सकती हूँ" for a woman).
 * The AI writes for one assumed speaker, so a female voice would say masculine words. This corrects the first-person endings in
 * what is about to be spoken, which also covers the greeting and the hand-over line. It touches only "<verb>ता/ती हूँ" and
 * "रहा/रही हूँ" ("I am doing"), which are unambiguous first-person forms: other words are left alone.
 */
export function matchGender(text: string, gender: Gender): string {
  if (!/[ऀ-ॿ]/.test(text)) return text;
  // A letter or vowel sign directly before the ending, so the ending is inside a word, not a standalone one.
  if (gender === "female") {
    return text.replace(/([\p{L}\p{M}]+)ता(\s+)(हूँ|हूं)/gu, "$1ती$2$3").replace(/रहा(\s+)(हूँ|हूं)/gu, "रही$1$2");
  }
  return text.replace(/([\p{L}\p{M}]+)ती(\s+)(हूँ|हूं)/gu, "$1ता$2$3").replace(/रही(\s+)(हूँ|हूं)/gu, "रहा$1$2");
}

/** Added to the instruction, so the AI chooses the right forms itself and its earlier turns stay consistent. */
export function speakerNote(gender: Gender): string {
  return gender === "female"
    ? " You are speaking as a woman. In Hindi and Hinglish always use feminine forms for yourself, for example 'मैं आपकी मदद कर सकती हूँ', 'मैं बता सकती हूँ', 'मैं समझ गई'. Never say 'सकता हूँ' or 'करता हूँ'."
    : " You are speaking as a man. In Hindi and Hinglish always use masculine forms for yourself, for example 'मैं आपकी मदद कर सकता हूँ', 'मैं बता सकता हूँ', 'मैं समझ गया'.";
}
