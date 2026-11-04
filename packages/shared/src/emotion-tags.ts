/**
 * Emotion tags in a script, e.g. "[excited] Great news! [calm] Now the details." (English or Hindi names).
 * A tag sets a style (speed, pitch, pause length) for the text after it, until the next tag. Tags are never spoken.
 * The voices have no emotion model, so this is a mild change of delivery, not acting.
 */
export interface EmotionSegment {
  text: string;
  /** Multiplies the voice's speed; added to its pitch (semitones). */
  speed: number;
  pitch: number;
  /** Multiplies the pauses between sentences. */
  pauseScale: number;
  /** Silence before this segment, from a [pause] tag. */
  pauseBeforeMs: number;
}

interface Style { speed: number; pitch: number; pauseScale: number }
const NEUTRAL: Style = { speed: 1, pitch: 0, pauseScale: 1 };
const STYLES: Record<string, Style> = {};
const add = (names: string[], style: Style) => names.forEach((n) => { STYLES[n] = style; });
add(["neutral", "normal", "reset", "सामान्य", "सामान्य"], NEUTRAL);
add(["excited", "happy", "cheerful", "enthusiastic", "खुश", "उत्साहित", "उत्साह", "ख़ुश"], { speed: 1.05, pitch: 0.3, pauseScale: 0.85 });
add(["calm", "soft", "gentle", "शांत", "नरम"], { speed: 0.92, pitch: -0.2, pauseScale: 1.2 });
add(["sad", "sorry", "apologetic", "उदास", "दुखी"], { speed: 0.92, pitch: -0.4, pauseScale: 1.3 });
add(["serious", "firm", "गंभीर"], { speed: 0.95, pitch: -0.3, pauseScale: 1.1 });
add(["angry", "annoyed", "गुस्सा", "नाराज़", "नाराज"], { speed: 1.06, pitch: -0.2, pauseScale: 0.9 });
add(["slow", "धीरे"], { speed: 0.85, pitch: 0, pauseScale: 1.2 });
add(["fast", "quick", "तेज़", "तेज"], { speed: 1.15, pitch: 0, pauseScale: 0.8 });
const PAUSES = new Set(["pause", "beat", "विराम", "रुकें"]);

/** `[word]`, not `[label](link)`. Short, one line. */
const TAG = /\[([^\[\]\n]{1,30})\](?!\()/g;

/** Removes every tag (known or not) so it is never read aloud. */
export const stripEmotionTags = (text: string) => text.replace(TAG, " ").replace(/[ \t]{2,}/g, " ").trim();

export const hasEmotionTags = (text: string) => { TAG.lastIndex = 0; return TAG.test(text); };

export function parseEmotionScript(text: string): EmotionSegment[] {
  const out: EmotionSegment[] = [];
  let style = NEUTRAL, pending = 0, last = 0;
  const push = (chunk: string) => {
    if (!/[\p{L}\p{N}]/u.test(chunk)) return;
    out.push({ text: chunk.trim(), speed: style.speed, pitch: style.pitch, pauseScale: style.pauseScale, pauseBeforeMs: pending });
    pending = 0;
  };
  for (const m of text.matchAll(TAG)) {
    push(text.slice(last, m.index));
    last = (m.index ?? 0) + m[0].length;
    const name = m[1]!.trim().toLowerCase();
    if (PAUSES.has(name)) pending += 800;
    else if (STYLES[name]) style = STYLES[name]!;
    // an unknown tag is dropped and the current style carries on
  }
  push(text.slice(last));
  return out;
}
