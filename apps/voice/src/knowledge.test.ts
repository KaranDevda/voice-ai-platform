import { describe, expect, it } from "vitest";
import { hindiToEnglishKeywords, relevantExcerpt } from "./knowledge";

const PRICING = `The Starter plan costs 1,999 rupees per month and includes up to 3 users and call recording for 30 days.

The Business plan starts at 4,999 rupees per month and includes up to 10 users, the AI phone assistant, call tracking for agent mobile phones, and transcripts with AI summaries. Paying annually saves 15 percent.

The Enterprise plan is priced on request and adds single sign-on, a dedicated onboarding manager, custom data retention and a service level agreement for uptime and support response.`;

describe("relevantExcerpt", () => {
  it("returns the paragraph that answers the question, not the whole passage", () => {
    const e = relevantExcerpt(PRICING, "How much does the business plan cost per month?", 300);
    expect(e).toContain("Business plan starts at 4,999");
    expect(e).not.toContain("Enterprise");
    expect(e.length).toBeLessThan(PRICING.length / 1.6);
  });
  it("finds the Enterprise paragraph for an Enterprise question", () => {
    expect(relevantExcerpt(PRICING, "does the enterprise plan include single sign-on", 300)).toContain("single sign-on");
  });
  it("returns short passages whole", () => {
    expect(relevantExcerpt("Calls are recorded for 180 days.", "recording", 380)).toBe("Calls are recorded for 180 days.");
  });
  it("falls back to the start of a long passage when nothing matches by word", () => {
    const e = relevantExcerpt(PRICING, "zzz qqq", 200);
    expect(e.length).toBeGreaterThan(20);
    expect(e.length).toBeLessThanOrEqual(260);
  });
  it("keeps the original order of the chosen paragraphs", () => {
    const e = relevantExcerpt(PRICING, "starter and business plan price", 600);
    expect(e.indexOf("Starter")).toBeLessThan(e.indexOf("Business"));
  });
});

describe("hindiToEnglishKeywords", () => {
  it("turns a Hindi price question into the words the pricing document uses", () => {
    const k = hindiToEnglishKeywords("बिज़नेस प्लान की कीमत क्या है?").split(" ");
    for (const w of ["business", "plan", "price", "cost", "rupees"]) expect(k).toContain(w);
  });
  it("treats बिज़नेस and बिजनेस (with and without the dot) as the same word", () => {
    expect(hindiToEnglishKeywords("बिजनेस प्लान")).toBe(hindiToEnglishKeywords("बिज़नेस प्लान"));
  });
  it("understands the other common questions", () => {
    expect(hindiToEnglishKeywords("क्या आप कॉल रिकॉर्ड करते हैं?")).toMatch(/recording/);
    expect(hindiToEnglishKeywords("एंटरप्राइज़ प्लान में क्या मिलता है?")).toMatch(/enterprise/);
    expect(hindiToEnglishKeywords("डेटा कितने दिन रखा जाता है?")).toMatch(/retention/);
  });
  it("keeps the English words people say in the middle of Hindi", () => {
    const k = hindiToEnglishKeywords("क्या आप call record करते हैं?").split(" ");
    for (const w of ["call", "record"]) expect(k).toContain(w);
    expect(hindiToEnglishKeywords("Enterprise plan में क्या मिलता है?")).toMatch(/enterprise plan/);
  });
  it("understands Hinglish written in English letters, without touching ordinary English questions", () => {
    expect(hindiToEnglishKeywords("mujhe pricing batao")).toMatch(/price/);
    expect(hindiToEnglishKeywords("business plan ka kitna kharcha hai")).toMatch(/cost/);
    const plain = hindiToEnglishKeywords("How do I record a call and get support?");
    expect(plain).not.toMatch(/retention|discount|annually/);
    expect(plain).toMatch(/record/);
  });
  it("also searches the singular, so 'plans' finds 'plan'", () => {
    const k = hindiToEnglishKeywords("What plans and users do you have?").split(" ");
    for (const w of ["plans", "plan", "users", "user"]) expect(k).toContain(w);
    expect(hindiToEnglishKeywords("business")).toBe("business");
  });
  it("gives nothing for a question with no known term", () => {
    expect(hindiToEnglishKeywords("भारत की राजधानी क्या है?")).toBe("");
  });
  it("finds the Business paragraph end to end", () => {
    const q = hindiToEnglishKeywords("बिज़नेस प्लान की कीमत क्या है?");
    expect(relevantExcerpt(PRICING, q, 300)).toContain("Business plan starts at 4,999");
  });
});
