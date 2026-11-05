/**
 * Stalling phrases the model sometimes writes on its own ("Sure, let me check that."). The real acknowledgement is played by ack.ts, only for a
 * real question or request, so a sentence that is nothing but stalling is never spoken, and a stalling opener is cut from the front of a longer one.
 */
const LEAD = "(?:(?:sure|certainly|of course|absolutely|okay|ok|alright|right|great|good question|one moment|just a moment|hold on)[,.!\\s]+)?";
const CHECK = "(?:let me|let me just|i'?ll|i will|i'?ll just|allow me to|give me a (?:moment|second|sec)(?: to)?|just a (?:moment|second|sec)(?: while i)?|one (?:moment|second|sec)(?: while i)?|hold on(?: while i)?|bear with me(?: while i)?)\\s*";
const VERB = "(?:check|look(?: that| this| it)? up|look into|look|see|find out|find|pull (?:that|this|it) up|get (?:that|this) for you|verify|confirm)";
const TAIL = "(?:\\s+(?:that|this|it|on that|on this|into that|into this|for you|that up|this up|right now|quickly|real quick|one moment|a moment|a second))*";
const WHOLE_EN = new RegExp(`^${LEAD}${CHECK}${VERB}${TAIL}\\s*[.!,…\\s]*$`, "i");
const WAIT_EN = /^(?:(?:sure|okay|ok|alright)[,.!\s]+)?(?:one moment|just a moment|just a second|one second|hold on|please hold|please wait|bear with me)(?:\s+please)?[.!,…\s]*$/i;
const OPENER_EN = /^(?:sure|certainly|of course|absolutely|great question|good question)[,!]\s+(?=\p{L})/iu;
const WHOLE_HI = /^(?:जी|ठीक है|ज़रूर|जरूर)?[,।\s]*(?:मैं\s+)?(?:ज़रा|जरा|अभी|बस)?\s*(?:देखता|देखती|चेक करता|चेक करती|देख लेता|देख लेती)\s+(?:हूँ|हूं)[।!\s]*$|^(?:बस\s+)?(?:एक\s+)?(?:पल|मिनट|सेकंड)(?:\s+(?:रुकिए|रुकिये|ठहरिए))?[।!\s]*$/u;

/** The sentence to speak, or "" when it is only stalling. */
export function dropFiller(sentence: string): string {
  const s = sentence.trim();
  if (!s) return "";
  if (WHOLE_EN.test(s) || WAIT_EN.test(s) || WHOLE_HI.test(s)) return "";
  const cut = s.replace(OPENER_EN, "");
  return cut === s ? s : cut.charAt(0).toUpperCase() + cut.slice(1);
}
