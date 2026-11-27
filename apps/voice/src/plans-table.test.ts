import { describe, expect, it } from "vitest";
import { asksAboutPlans, extractPlans } from "./plans-table";

const KB = "The Starter plan costs 1,999 rupees per month and includes up to 3 users and call recording for 30 days.\n\nThe Business plan starts at 4,999 rupees per month and includes up to 10 users, the AI phone assistant, call tracking for agent mobile phones, and transcripts with AI summaries. Paying annually saves 15 percent.\n\nThe Enterprise plan is priced on request and adds single sign-on, a dedicated onboarding manager, custom data retention and priority support. All plans include unlimited leads.";

describe("plans table", () => {
  it("reads every plan, its price and what it includes", () => {
    const card = extractPlans([KB])!;
    expect(card.rows.map((r) => [r.name, r.price])).toEqual([["Starter", "₹1,999 / month"], ["Business", "From ₹4,999 / month"], ["Enterprise", "On request"]]);
    expect(card.rows[0]!.includes).toBe("up to 3 users and call recording for 30 days");
    expect(card.notes.join(" ")).toContain("Paying annually saves 15 percent");
  });
  it("shows nothing when the knowledge has no plans", () => { expect(extractPlans(["Recordings are kept for 180 days."])).toBeNull(); });
  it("recognises plan questions", () => {
    expect(asksAboutPlans("What plans do you have?")).toBe(true);
    expect(asksAboutPlans("how much does it cost")).toBe(true);
    expect(asksAboutPlans("Can you integrate with my platform?")).toBe(false);
  });
});
