import { describe, expect, it } from "vitest";
import { ackFor } from "./ack";

describe("ackFor", () => {
  it("says Sure to a question and Okay to a statement", () => {
    expect(ackFor("What are your prices for the pro plan?", "en")).toBe("Sure.");
    expect(ackFor("I would like to book an appointment tomorrow", "en")).toBe("Okay.");
  });
  it("stays quiet for greetings, short replies, thanks and Hindi", () => {
    expect(ackFor("Hello", "en")).toBeNull();
    expect(ackFor("Hello how are you today", "en")).toBeNull();
    expect(ackFor("yes please", "en")).toBeNull();
    expect(ackFor("आपकी कीमत क्या है बताइए", "en")).toBeNull();
    expect(ackFor("What are your prices for the pro plan?", "hi")).toBeNull();
    expect(ackFor("नमस्ते आप कैसे हैं आज", "hi", true)).toBeNull();
  });
  it("says जी in Hindi only when the voice is fast in Hindi", () => {
    expect(ackFor("आपकी कीमत क्या है बताइए", "hi")).toBeNull();
    expect(ackFor("आपकी कीमत क्या है बताइए", "hi", true)).toBe("जी।");
  });
});
