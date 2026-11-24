import { describe, expect, it } from "vitest";
import { createCashfreeVerifier, kycVerifierFromEnv, parseGstinAnswer, parsePanAnswer } from "./kyc-verify";

const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("PAN answers", () => {
  it("a valid PAN with the holder's name and match score", () => {
    expect(parsePanAnswer(200, { pan: "ABCPV1234D", valid: true, registered_name: "KARAN DEVDA", name_match_score: "92.50", message: "PAN verified successfully" }))
      .toEqual({ status: "valid", registeredName: "KARAN DEVDA", nameMatchScore: 92.5, message: "PAN verified successfully" });
  });
  it("an unknown PAN is invalid", () => {
    expect(parsePanAnswer(200, { valid: false, message: "Invalid PAN" })).toEqual({ status: "invalid", message: "Invalid PAN" });
    expect(parsePanAnswer(422, { message: "pan is invalid" }).status).toBe("invalid");
  });
  it("our keys refused or the service down is an error, never 'invalid'", () => {
    expect(parsePanAnswer(401, {}).status).toBe("error");
    expect(parsePanAnswer(503, {}).status).toBe("error");
  });
});

describe("GSTIN answers", () => {
  it("an active GSTIN is valid, with the legal name", () => {
    expect(parseGstinAnswer(200, { GSTIN: "23HRQPD2324F1Z1", valid: true, gst_in_status: "Active", legal_name_of_business: "BIZFY DEMO PRIVATE LIMITED" }))
      .toEqual({ status: "valid", gstStatus: "Active", registeredName: "BIZFY DEMO PRIVATE LIMITED" });
  });
  it("a cancelled or suspended GSTIN is invalid", () => {
    expect(parseGstinAnswer(200, { valid: true, gst_in_status: "Cancelled" })).toMatchObject({ status: "invalid", gstStatus: "Cancelled" });
  });
  it("a GSTIN that does not exist is invalid", () => {
    expect(parseGstinAnswer(200, { valid: false, message: "GSTIN Doesn't Exist" })).toMatchObject({ status: "invalid", message: "GSTIN Doesn't Exist" });
  });
});

describe("Cashfree verifier", () => {
  it("sends the documented requests with the client keys", async () => {
    const seen: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    const doFetch: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) });
      return String(url).endsWith("/pan") ? reply(200, { valid: true, registered_name: "X" })() : reply(200, { valid: true, gst_in_status: "Active" })();
    };
    const v = createCashfreeVerifier({ clientId: "id", clientSecret: "secret", fetch: doFetch });
    expect((await v.verifyPan("ABCPV1234D", "Karan")).status).toBe("valid");
    expect((await v.verifyGstin("23HRQPD2324F1Z1", "Bizfy")).status).toBe("valid");
    expect(seen[0]).toMatchObject({ url: "https://sandbox.cashfree.com/verification/pan", body: { pan: "ABCPV1234D", name: "Karan" } });
    expect(seen[0]!.headers["x-client-id"]).toBe("id");
    expect(seen[1]).toMatchObject({ url: "https://sandbox.cashfree.com/verification/gstin", body: { GSTIN: "23HRQPD2324F1Z1", business_name: "Bizfy" } });
  });
  it("is off unless keys are set", () => {
    expect(kycVerifierFromEnv({})).toBeNull();
    expect(kycVerifierFromEnv({ KYC_PROVIDER: "cashfree", CASHFREE_CLIENT_ID: "id" })).toBeNull();
    expect(kycVerifierFromEnv({ CASHFREE_CLIENT_ID: "id", CASHFREE_CLIENT_SECRET: "s" })?.provider).toBe("cashfree");
  });
});
