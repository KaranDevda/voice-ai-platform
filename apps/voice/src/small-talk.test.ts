import { describe, expect, it } from "vitest";
import { replyToGreeting, replyToIdentityQuestion } from "./small-talk";

describe("replyToGreeting", () => {
  it("responds naturally and immediately to English greetings", () => {
    expect(replyToGreeting("Hello", "en")).toBe("Hi! How can I help you today?");
    expect(replyToGreeting("Good morning, how are you?", "en")).toBe("Good morning! I'm doing well, thank you. How can I help you today?");
    expect(replyToGreeting("How are you?", "en")).toBe("I'm doing well, thank you. How can I help you today?");
  });

  describe("replyToIdentityQuestion", () => {
    it("answers direct English identity questions truthfully", () => {
      expect(replyToIdentityQuestion("What are you?", "en")).toBe("I'm Bizfy's AI voice assistant. I can help with our plans and services.");
      expect(replyToIdentityQuestion("Are you an AI?", "en")).toContain("AI voice assistant");
      expect(replyToIdentityQuestion("What plans do you have?", "en")).toBeNull();
    });
  });

  it("answers in the selected or detected Hindi and Hinglish", () => {
    expect(replyToGreeting("नमस्ते", "hi")).toBe("नमस्ते! बताइए, मैं आपकी क्या मदद करूँ?");
    expect(replyToGreeting("नमस्ते, आप कैसे हैं?", "en-hi")).toContain("मैं ठीक हूँ");
    expect(replyToGreeting("namaste", "en-hi")).toContain("बताइए");
    expect(replyToGreeting("Hi, kaise ho aap?", "en-hi")).toContain("thank you");
    expect(replyToGreeting("नमस्ते", "en")).toBe("Hi! How can I help you today?");
  });

  it("leaves questions and non-greeting small talk for the normal conversation path", () => {
    expect(replyToGreeting("Tell me about the Business plan.", "en")).toBeNull();
    expect(replyToGreeting("What's the personal plan?", "en")).toBeNull();
    expect(replyToGreeting("Thanks, tell me about pricing.", "en")).toBeNull();
  });
});
