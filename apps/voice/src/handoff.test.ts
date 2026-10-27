import { describe, expect, it } from "vitest";
import { detectHandoff } from "./handoff";

const ALL = { person: true, complaint: true, payment: true };
const reason = (t: string, e = ALL) => detectHandoff(t, e);

describe("detectHandoff", () => {
  it("hands over when the caller asks for a person, in English, Hindi and Hinglish", () => {
    for (const t of ["Can I speak to a real person?", "I want to talk to a human", "Please connect me to an agent", "transfer me to your manager", "I need a real person", "put me through to someone",
      "मुझे किसी इंसान से बात करनी है", "एजेंट से बात करवाइए", "मैनेजर से जोड़ दीजिए", "agent se baat karwao", "mujhe insaan se baat karni hai", "manager ko connect karo", "baat karwa do"]) expect(reason(t), t).toBe("person");
  });
  it("hands over for a complaint or a payment problem, and the order is person, complaint, payment", () => {
    expect(reason("I want to make a complaint")).toBe("complaint");
    expect(reason("this is a fraud, you cheated me")).toBe("complaint");
    expect(reason("मुझे शिकायत करनी है")).toBe("complaint");
    expect(reason("mujhe shikayat karni hai")).toBe("complaint");
    expect(reason("I want a refund")).toBe("payment");
    expect(reason("my money was deducted twice")).toBe("payment");
    expect(reason("पैसे कट गए हैं, रिफंड चाहिए")).toBe("payment");
    expect(reason("mujhe refund chahiye")).toBe("payment");
    expect(reason("where is my refund")).toBe("payment");
    expect(reason("I want a refund and to speak to a manager")).toBe("person");
  });
  it("does not hand over for ordinary questions that only contain the same words", () => {
    for (const t of ["How do I connect an agent's phone to the app?", "What is the price of the Business plan?", "Do agents get their own login?", "Tell me about call tracking for agent mobile phones",
      "Is there a payment option for annual plans?", "What is your refund policy?", "How many users can I add?", "बिज़नेस प्लान की कीमत क्या है?", "क्या आप कॉल रिकॉर्ड करते हैं?", "okay thanks", ""]) expect(reason(t), t).toBeNull();
  });
  it("respects the organisation's switches", () => {
    expect(reason("I want a refund", { ...ALL, payment: false })).toBeNull();
    expect(reason("I have a complaint", { ...ALL, complaint: false })).toBeNull();
    expect(reason("speak to a human", { ...ALL, person: false })).toBeNull();
  });
});

describe("Hindi spellings of 'a person'", () => {
  const on = { person: true, complaint: true, payment: true };
  it("hands over for each spelling Whisper may write", () => {
    for (const q of ["क्या मैं किसी इंसान से बात कर सकता हूँ", "क्या मैं किसी इनसान से बात कर सकता हूं।", "मुझे किसी इन्सान से बात करनी है", "किसी व्यक्ति से बात करवाइए"]) expect(detectHandoff(q, on)).toBe("person");
  });
  it("does not hand over for an ordinary question", () => {
    expect(detectHandoff("प्लान की कीमत क्या है", on)).toBeNull();
  });
});
