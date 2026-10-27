import { describe, expect, it } from "vitest";
import { AUTO_APPLY_MIN_CONFIDENCE, decideStatusChange, extractJsonObject, parseAnalysis } from "./post-call";

describe("decideStatusChange", () => {
  it("applies a confident suggestion, queues a hesitant one, and ignores no change", () => {
    expect(decideStatusChange({ current: "new", suggested: "interested", confidence: 0.9 })).toBe("apply");
    expect(decideStatusChange({ current: "new", suggested: "interested", confidence: AUTO_APPLY_MIN_CONFIDENCE })).toBe("apply");
    expect(decideStatusChange({ current: "new", suggested: "interested", confidence: 0.79 })).toBe("queue");
    expect(decideStatusChange({ current: "new", suggested: "interested", confidence: null })).toBe("queue");
    expect(decideStatusChange({ current: "interested", suggested: "interested", confidence: 0.99 })).toBe("none");
    expect(decideStatusChange({ current: "new", suggested: null, confidence: 0.99 })).toBe("none");
  });
  it("never closes a lead on its own, and never reopens a closed one", () => {
    expect(decideStatusChange({ current: "interested", suggested: "won", confidence: 1 })).toBe("queue");
    expect(decideStatusChange({ current: "interested", suggested: "lost", confidence: 1 })).toBe("queue");
    expect(decideStatusChange({ current: "won", suggested: "interested", confidence: 1 })).toBe("queue");
    expect(decideStatusChange({ current: "lost", suggested: "new", confidence: 1 })).toBe("queue");
  });
});

describe("extractJsonObject", () => {
  it("finds the object inside words or a code fence, and handles braces inside strings", () => {
    expect(extractJsonObject('Here you go:\n```json\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(extractJsonObject('{"a": "x } y", "b": {"c": 2}} trailing')).toBe('{"a": "x } y", "b": {"c": 2}}');
    expect(extractJsonObject("no json here")).toBeNull();
    expect(extractJsonObject('{"unfinished": ')).toBeNull();
  });
});

describe("parseAnalysis", () => {
  const good = { summary: "Caller asked about the Business plan price.", intent: "pricing inquiry", sentiment_score: 0.4, sentiment: "positive", next_action: "Send the plan details", suggested_status: "interested", confidence: 0.86, do_not_call: false };
  it("accepts a good answer and cleans it", () => {
    expect(parseAnalysis(JSON.stringify(good))).toEqual({ summary: good.summary, intent: "pricing_inquiry", sentimentScore: 0.4, sentimentLabel: "positive", nextAction: "Send the plan details", suggestedStatus: "interested", confidence: 0.86, doNotCall: false });
  });
  it("copes with numbers as text, odd status spelling, and a fence around the answer", () => {
    const a = parseAnalysis("```json\n" + JSON.stringify({ ...good, sentiment_score: "0.4", confidence: "0.9", suggested_status: "Callback Requested" }) + "\n```");
    expect(a).toMatchObject({ sentimentScore: 0.4, confidence: 0.9, suggestedStatus: "callback_requested" });
  });
  it("keeps numbers in range, and drops an invented status and its confidence", () => {
    const a = parseAnalysis(JSON.stringify({ ...good, sentiment_score: 7, confidence: 3, suggested_status: "vip_customer" }))!;
    expect(a.sentimentScore).toBe(1);
    expect(a.suggestedStatus).toBeNull();
    expect(a.confidence).toBeNull();
    expect(parseAnalysis(JSON.stringify({ ...good, confidence: 3 }))!.confidence).toBe(1);
  });
  it("lets the number decide when the word contradicts it", () => {
    expect(parseAnalysis(JSON.stringify({ ...good, sentiment: "positive", sentiment_score: -0.6 }))!.sentimentLabel).toBe("negative");
    expect(parseAnalysis(JSON.stringify({ ...good, sentiment: "negative", sentiment_score: 0.5 }))!.sentimentLabel).toBe("positive");
    expect(parseAnalysis(JSON.stringify({ ...good, sentiment: "neutral", sentiment_score: 0.05 }))!.sentimentLabel).toBe("neutral");
  });
  it("reads do_not_call as true only when it clearly says so", () => {
    expect(parseAnalysis(JSON.stringify({ ...good, do_not_call: true }))!.doNotCall).toBe(true);
    expect(parseAnalysis(JSON.stringify({ ...good, do_not_call: "yes" }))!.doNotCall).toBe(true);
    expect(parseAnalysis(JSON.stringify({ ...good, do_not_call: "maybe" }))!.doNotCall).toBe(false);
    const { do_not_call, ...without } = good; void do_not_call;
    expect(parseAnalysis(JSON.stringify(without))!.doNotCall).toBe(false);
  });
  it("refuses an answer it cannot use", () => {
    for (const bad of ["", "I cannot help with that", '{"summary": ""}', '{"intent": "x"}', "[1,2,3]", '{"summary": 5, "x": }']) expect(parseAnalysis(bad)).toBeNull();
  });
  it("cuts overlong text", () => {
    const a = parseAnalysis(JSON.stringify({ ...good, summary: "x".repeat(2000), next_action: "y".repeat(2000) }))!;
    expect(a.summary).toHaveLength(600); expect(a.nextAction).toHaveLength(300);
  });
});
