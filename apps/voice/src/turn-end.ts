/**
 * Did the caller finish their sentence? The voice detector only hears a pause; the words say more. A transcript that stops on "and",
 * "because", "मेरा नाम" or a comma is almost always a pause in the middle of a sentence, so the AI waits a moment for the rest instead
 * of answering half a question. That wait lets the silence rule be short (ENDPOINTING_MS 250) without cutting people off.
 */
const EN = "and but or so because if that which who the a an to of for with in on at by my your our his her their is are was were be been am i we you they it um uh er like also then about from into than as when while whose what how where plan plans".split(" ");
const HI = "और लेकिन पर मगर क्योंकि कि तो में का की के से को भी या अगर जब तब मैं मेरा मेरी मेरे हम हमारा हमारी हमारे आप आपका आपकी आपके एक यह ये वो वह कुछ इस उस जो जैसे फिर तक लिए साथ बारे ताकि है हैं था थी थे".split(" ");
const ROMAN = "aur lekin par magar kyunki kyunki ki ke ka toh to mein me se ko bhi ya agar jab tab main mera meri mere hum humara aap aapka aapki aapke ek yeh ye woh wo kuch is us jo jaise phir tak liye saath baare taaki hai hain tha thi the".split(" ");
const OPEN = new Set([...EN, ...HI, ...ROMAN]);
// Words that end a complete sentence even though they are in the lists above ("मेरा नाम रोहन है", "I am fine, thank you", "okay sure").
const CLOSERS = new Set(["है", "हैं", "था", "थी", "थे", "hai", "hain", "tha", "thi", "the", "it", "you", "me", "too", "so"]);

/** True when the transcript looks like it stopped in the middle of a sentence. Ends in ? ! . । => finished. */
export function looksUnfinished(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[?!।.]["')\]]*$/.test(t) && !/\.\.\.$|…$/.test(t)) return false;
  if (/[,;:\-–—]$|\.\.\.$|…$/.test(t)) return true;
  const last = t.replace(/[^\p{L}\p{M}\p{N}\s']/gu, "").trim().split(/\s+/).pop()?.toLowerCase() ?? "";
  if (!last) return false;
  // Hindi verbs of being end a sentence; the rest of the open words ("और", "because", "my") do not.
  if (/^(है|हैं|था|थी|थे|hai|hain|tha|thi)$/.test(last)) return false;
  return OPEN.has(last) && !CLOSERS.has(last);
}
