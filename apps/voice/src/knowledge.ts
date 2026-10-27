const STOP = new Set(["the", "and", "for", "are", "you", "your", "what", "how", "does", "can", "with", "that", "this", "have", "has", "from", "about", "much", "many", "per", "tell", "please", "there", "any", "get", "give", "need", "want"]);

const words = (text: string) => (text.toLowerCase().match(/[\p{L}\p{M}\p{N}]{3,}/gu) ?? []).filter((w) => !STOP.has(w));

/**
 * Picks the part of a knowledge passage that answers the question: the paragraphs sharing the most words with it, kept
 * in their original order, up to `max` characters. A short, relevant excerpt is faster for the model to read and
 * leaves less room to wander off topic than a whole document chunk.
 */
export function relevantExcerpt(content: string, query: string, max = 380): string {
  const q = new Set(words(query));
  const paragraphs = content.split(/\n{2,}|(?<=[.!?।])\s+(?=[A-Zऀ-ॿ])/).map((p) => p.trim()).filter(Boolean);
  if (content.length <= max || paragraphs.length <= 1) return content.length <= max ? content : content.slice(0, max).replace(/\s+\S*$/, "") + "...";
  const scored = paragraphs.map((p, i) => ({ p, i, s: words(p).filter((w) => q.has(w)).length }));
  const chosen: typeof scored = [];
  let used = 0;
  for (const c of [...scored].sort((a, b) => b.s - a.s || a.i - b.i)) {
    if (c.s === 0 && chosen.length) break;
    if (used + c.p.length > max && chosen.length) continue;
    chosen.push(c); used += c.p.length + 1;
  }
  return chosen.sort((a, b) => a.i - b.i).map((c) => c.p).join(" ").slice(0, max + 60);
}

/**
 * Hindi question words mapped to the English words the knowledge base uses. The knowledge base is English and matched by
 * words, so without this a Hindi question finds nothing. It is a stop-gap: multilingual search (embeddings) replaces it.
 * Matching ignores the nukta mark, so बिज़नेस and बिजनेस are the same.
 */
const GLOSSARY: Array<[string[], string]> = [
  [["कीमत", "दाम", "मूल्य", "रेट", "शुल्क", "कितना", "कितने रुपये", "खर्च", "पैसे", "प्राइसिंग", "प्राइस"], "price cost rupees per month"],
  [["प्लान", "प्लांस", "प्लान्स", "योजना", "पैकेज", "प्राइसिंग", "प्राइस"], "plan"],
  [["बिजनेस", "व्यापार"], "business"],
  [["स्टार्टर"], "starter"],
  [["एंटरप्राइज", "उद्यम"], "enterprise"],
  [["रिकॉर्ड"], "call recording recorded"],
  [["कॉल"], "call"],
  [["ट्रांसक्रिप्ट"], "transcripts"],
  [["सारांश", "समरी"], "summaries"],
  [["यूजर", "उपयोगकर्ता"], "users"],
  [["सपोर्ट", "सहायता", "मदद"], "support"],
  [["सुरक्षा", "सिक्योरिटी", "डेटा"], "data security"],
  [["रिटेंशन", "कितने दिन", "कब तक", "रखा जाता", "रखते"], "retention days"],
  [["मोबाइल", "फोन", "एंड्रॉइड", "एंड्रॉयड"], "mobile phone android"],
  [["ट्रैकिंग", "ट्रैक"], "tracking"],
  [["एआई", "असिस्टेंट"], "AI assistant"],
  [["साइन-ऑन", "साइन ऑन", "सिंगल साइन"], "single sign-on"],
  [["वार्षिक", "सालाना", "साल"], "annually annual"],
  [["छूट", "बचत", "डिस्काउंट"], "saves discount"],
];

/**
 * Hinglish written in English letters. Only words that are not ordinary English belong here, so an English question is
 * never given extra search words it did not ask for.
 */
const LATIN_HINGLISH: Array<[RegExp, string]> = [
  [/\b(kitna|kitne|kimat|keemat|qimat|daam|dam|paise|rupaye|rupay|kharcha|pricing)\b/i, "price cost rupees per month"],
  [/\b(yojana)\b/i, "plan"],
  [/\b(kitne din|kab tak)\b/i, "retention days"],
  [/\b(madad|sahayata)\b/i, "support"],
  [/\b(chhoot|bachat)\b/i, "saves discount"],
  [/\b(saalana|salana)\b/i, "annually annual"],
  [/\b(suraksha)\b/i, "data security"],
];

const stripNukta = (t: string) => t.normalize("NFC").replace(/\u093C/g, "");

/**
 * English search words for a Hindi or mixed Hindi-English question: any English words already in it (people say "call
 * record" and "Enterprise plan" in the middle of Hindi, and Whisper writes them that way) plus the glossary words for
 * the Hindi terms. Returns "" when there is nothing to search with.
 */
export function hindiToEnglishKeywords(question: string): string {
  const q = stripNukta(question);
  const out: string[] = question.match(/[A-Za-z][A-Za-z-]{2,}/g) ?? [];
  for (const [hindi, english] of GLOSSARY) if (hindi.some((h) => q.includes(stripNukta(h)))) out.push(...english.split(" "));
  for (const [re, english] of LATIN_HINGLISH) if (re.test(question)) out.push(...english.split(" "));
  // "plans" must find "plan" in the documents: search the singular too.
  for (const w of [...out]) if (/^[a-z-]{4,}s$/i.test(w) && !/ss$/i.test(w)) out.push(w.slice(0, -1));
  return [...new Set(out.map((w) => w.toLowerCase()))].join(" ");
}
