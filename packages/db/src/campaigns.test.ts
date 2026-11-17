import { describe, expect, it } from "vitest";
import { verifyVoiceToken } from "@voiceai/auth";
import { dialToken, type DialJob } from "./campaigns";

const KEY = "campaign-token-test-key-0123456789";

describe("campaign dial token", () => {
  it("carries the campaign model override to the voice service without provider credentials", () => {
    const job: DialJob = {
      targetId: "target", campaignId: "campaign", orgId: "org", leadId: "lead", language: "en",
      voice: "pocket:alba", callerId: null, createdBy: "creator", detectMachines: true, opening: null, mode: "ai",
      aiModel: "openrouter", openrouterModel: "google/gemini-2.5-flash", agentProfileId: "123e4567-e89b-42d3-a456-426614174000",
    };
    const claims = verifyVoiceToken(dialToken(job, KEY), KEY);
    expect(claims).toEqual({ sub: "creator", org: "org", voice: "pocket:alba", aiModel: "openrouter", openrouterModel: "google/gemini-2.5-flash", agentProfileId: "123e4567-e89b-42d3-a456-426614174000" });
    expect(JSON.stringify(claims)).not.toContain("API_KEY");
  });

  it("leaves the organisation model inherited when no campaign override is selected", () => {
    const job: DialJob = {
      targetId: "target", campaignId: "campaign", orgId: "org", leadId: "lead", language: "en",
      voice: null, callerId: null, createdBy: "creator", detectMachines: true, opening: null, mode: "ai",
      aiModel: null, openrouterModel: null, agentProfileId: null,
    };
    expect(verifyVoiceToken(dialToken(job, KEY), KEY)).toEqual({ sub: "creator", org: "org" });
  });
});
