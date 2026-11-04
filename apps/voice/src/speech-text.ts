import { speakableNumbers, spellOutHindiNumbers } from "@voiceai/shared";
export { hindiNumberWords, spellOutHindiNumbers } from "@voiceai/shared";

/**
 * Turns a model's written reply into text that sounds right when spoken: no markdown symbols, emoji, bullets or
 * stage directions, which a voice would read aloud or stumble over.
 */
export function forSpeech(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")              // code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")       // [label](link) -> label
    .replace(/\[[^\[\]\n]{1,30}\](?!\()/g, " ")        // [excited]-style tags are never spoken
    .replace(/https?:\/\/\S+/g, " ")              // bare links
    .replace(/[*_#`>~|]+/g, " ")                    // markdown marks
    .replace(/^\s*[-\u2022]\s+/gm, "")             // bullets at line start
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D/gu, "")  // emoji
    .replace(/\([^)]{0,60}\)/g, (m) => (/[\u0900-\u097F]/.test(m) ? m : " ")) // short asides in brackets, kept if Hindi
    .replace(/\s+/g, " ")
    .trim();
}

/** What is actually sent to the voice: cleaned of markup, with phone numbers, OTPs, rupee amounts, e-mails and Hindi numbers written the way they are said. */
export const forVoice = (text: string) => spellOutHindiNumbers(speakableNumbers(forSpeech(text)));
