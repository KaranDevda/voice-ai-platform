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
  /(इंसान|व्यक्ति|आदमी|एजेंट|मैनेजर|एक्जीक्यूटिव|एक्ज़ीक्यूटिव|कर्मचारी|सहयोगी|सुपरवाइज़र|सुपरवाइजर)[^।?!]{0,25}(बात|जोड़|मिला)/,
  /(बात|जोड़|मिला)[^।?!]{0,25}(इंसान|व्यक्ति|आदमी|एजेंट|मैनेजर|एक्जीक्यूटिव|एक्ज़ीक्यूटिव|कर्मचारी|सहयोगी|सुपरवाइज़र|सुपरवाइजर)/,
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

/** Why this caller should be handed to a person, or null to carry on (SOP: asks for a person, complaint, payment). */
export function detectHandoff(text: string, enabled: HandoffEnabled): HandoffReason | null {
  const hit = (list: RegExp[]) => list.some((r) => r.test(text));
  if (enabled.person && hit(PERSON)) return "person";
  if (enabled.complaint && hit(COMPLAINT)) return "complaint";
  if (enabled.payment && hit(PAYMENT)) return "payment";
  return null;
}

export const HANDOFF_HINDI = "ठीक है, मैं आपकी बात हमारे एक सहयोगी से करवाता हूँ। कृपया लाइन पर बने रहिए।";
export const HANDOFF_ENGLISH = "Let me connect you with a colleague. Please stay on the line.";
