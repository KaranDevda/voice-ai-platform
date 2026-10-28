/** The recogniser often drops the dot under a Hindi letter (जोड़ becomes जोड, बिज़नेस becomes बिजनेस): compare without it. */
const plain = (s: string) => s.normalize("NFD").replace(/\u093C/g, "").normalize("NFC");
const plainAll = (list: RegExp[]) => list.map((r) => new RegExp(plain(r.source), r.flags));

export type HandoffReason = "person" | "complaint" | "payment" | "pipeline_error";
export interface HandoffEnabled { person: boolean; complaint: boolean; payment: boolean }

// What the caller says when they want a human. The patterns need "to" or "with" after talk/connect, so "connect an agent's phone"
// (a question about the product) does not hand the call over.
const PERSON: RegExp[] = [
  /\b(talk|speak|connect|transfer|put)\b\s+(me\s+)?\b(to|with|through to)\b\s+(a|an|the|your|some)?\s*(real\s+|live\s+|actual\s+)?(person|human|agent|representative|someone|somebody|manager|executive|operator|supervisor|staff)\b/i,
  /\b(want|need|get me|give me|i'd like)\s+(a|an|the)?\s*(real\s+|live\s+|actual\s+)?(person|human|representative|supervisor)\b/i,
  /\b(real|actual|live)\s+(person|human)\b/i,
  /\b(agent|manager|insaan|insan|executive|banda|aadmi|admi|supervisor)\s+(se|ko)\b[^.?!]{0,25}\b(baat|connect|milao|milwa|jodo|transfer)/i,
  /\bbaat\s+(karwa|karao|karva)/i,
  /(इंसान|इनसान|इन्सान|व्यक्ति|आदमी|एजेंट|मैनेजर|एक्जीक्यूटिव|एक्ज़ीक्यूटिव|कर्मचारी|सहयोगी|सुपरवाइज़र|सुपरवाइजर)[^।?!]{0,25}(बात|जोड़|मिला)/,
  /(बात|जोड़|मिला)[^।?!]{0,25}(इंसान|इनसान|इन्सान|व्यक्ति|आदमी|एजेंट|मैनेजर|एक्जीक्यूटिव|एक्ज़ीक्यूटिव|कर्मचारी|सहयोगी|सुपरवाइज़र|सुपरवाइजर)/,
];
const COMPLAINT: RegExp[] = [
  /\b(complaint|complain(ing)?|fraud|cheat(ed|ing)?|scam|legal action|consumer court|lawyer|sue you)\b/i,
  /(शिकायत|धोखा|ठगी|धोखाधड़ी|कंप्लेंट|कम्प्लेंट)/,
  /\b(shikayat|shikaayat|dhokha|thagi)\b/i,
];
// A bare mention of "refund" is often a question about policy; it is asking for one, or reporting a problem, that needs a person.
const PAYMENT: RegExp[] = [
  /\b(want|need|get|give me|demand|request|require)\b[^.?!]{0,15}\b(refund|money back)\b/i,
  /\brefund\s+(me|my|please|now)\b/i,
  /\b(my|the)\s+refund\b/i,
  /\b(chargeback|money (was |got )?(deducted|debited|cut)|double (charged|payment)|charged twice|wrong charge|payment (failed|issue|problem))\b/i,
  /(रिफंड|पैसे वापस|पैसा वापस)[^।?!]{0,12}(चाहिए|करो|कर दो|दीजिए|दो|नहीं मिला)/,
  /(पैसे कट|पैसा कट|दो बार (कट|चार्ज)|पेमेंट (फेल|की समस्या))/,
  /\b(paise|paisa)\s+(kat|cut)\b|\brefund\s+(chahiye|karo|do)\b/i,
];

const PERSON_P = plainAll(PERSON), COMPLAINT_P = plainAll(COMPLAINT), PAYMENT_P = plainAll(PAYMENT);

/** Why this caller should be handed to a person, or null to carry on (SOP: asks for a person, complaint, payment). */
export function detectHandoff(text: string, enabled: HandoffEnabled): HandoffReason | null {
  const t = plain(text);
  const hit = (list: RegExp[]) => list.some((r) => r.test(t));
  if (enabled.person && hit(PERSON_P)) return "person";
  if (enabled.complaint && hit(COMPLAINT_P)) return "complaint";
  if (enabled.payment && hit(PAYMENT_P)) return "payment";
  return null;
}

export const HANDOFF_HINDI = "ठीक है, मैं आपकी बात हमारे एक सहयोगी से करवाता हूँ। कृपया लाइन पर बने रहिए।";
export const HANDOFF_ENGLISH = "Let me connect you with a colleague. Please stay on the line.";

// The AI offers a person ("if you like, I will connect you with a colleague"): the next "yes" from the caller must really hand the call over.
const OFFER: RegExp[] = [
  /\bconnect (you|them) (with|to) (a|an|the|one of|someone|somebody|our|my)\b/i,
  /\b(put|transfer) you (through )?(to|with)\b/i,
  /(साथी|सहयोगी|इंसान|व्यक्ति|एजेंट|मैनेजर|कर्मचारी)[^।?!]{0,20}(से|को)[^।?!]{0,25}(जोड़|मिला|बात)/,
  /(जोड़|मिला|बात करवा)[^।?!]{0,20}(साथी|सहयोगी|इंसान|व्यक्ति|एजेंट|मैनेजर)/,
];
const OFFER_P = plainAll(OFFER);
export const offeredHandoff = (assistantText: string | undefined): boolean => !!assistantText && OFFER_P.some((r) => r.test(plain(assistantText)));

// The AI says it IS connecting the caller (not "if you like" or "I can"): the call must really be handed over, or the caller is left waiting.
const COMMIT: RegExp[] = [
  /(अभी|तुरंत|अब)[^।?!]{0,25}(जोड़|मिला|करवा)[^।?!]{0,12}(देता|देती|रहा|रही|ता|ती) ?(हूँ|हूं)/,
  /मैं आपको[^।?!]{0,30}(जोड़|मिला)[^।?!]{0,12}(देता|देती|रहा|रही) ?(हूँ|हूं)/,
  /\b(let me|i('| wi)ll|i am|i'm)\s+(now\s+)?(connect|transfer|put)(ing)?\s+you\b/i,
  /\bconnecting you\b/i,
];
const CONDITIONAL = /(अगर|चाहें|चाहे|क्या आप|\bif you\b|\bwould you\b|\bcan connect\b|\bcould connect\b|\bwant me to\b)/i;
const COMMIT_P = plainAll(COMMIT);
/** True when a reply promises to connect the caller right now. */
export const commitsToConnect = (assistantText: string): boolean => {
  const t = plain(assistantText);
  return !CONDITIONAL.test(t) && COMMIT_P.some((r) => r.test(t));
};

const NO = /(नहीं|नही|मत |मत$|रहने दो|रहने दीजिए|ज़रूरत नहीं|जरूरत नहीं|\bno\b|\bnope\b|\bnot now\b|don'?t|\bnahi\b|\bnahin\b|\bmat\b)/i;
const YES = /(हाँ|हां|\bहा\b|\bजी\b|ठीक|ओके|\bok(ay)?\b|\byes\b|\byeah\b|\byep\b|\bsure\b|\bplease\b|कीजिए|कीजिये|कर दो|कर दीजिए|दीजिए|दीजिये|दो\b|जोड़|जोड|मिला|कनेक्ट|\bconnect\b|\bhaan\b|\bha\b|\btheek\b|\bthik\b|\bji\b|\bchalo\b|चलिए|चलो|बिल्कुल|ज़रूर|जरूर|\bgo ahead\b)/i;
const NO_P = new RegExp(plain(NO.source), NO.flags), YES_P = new RegExp(plain(YES.source), YES.flags);
/** A short "yes" (also when the recogniser garbled part of it, as in "ठीक है जोड दीजाँ"). A long answer is a new question, not a yes. */
export function isAgreement(text: string): boolean {
  const t = text.trim();
  if (!t || t.split(/\s+/).length > 8 || NO_P.test(plain(t))) return false;
  return YES_P.test(plain(t));
}
