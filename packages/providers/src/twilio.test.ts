import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeTrunkHealth, createTwilio, isPrivateAddress, probeSipEndpoint, twilioSignature, verifyTwilioSignature, type TrunkHealthInput } from "./twilio";

const TOKEN = "twilio-test-token";

describe("Twilio webhook signature", () => {
  it("is HMAC-SHA1 of the URL plus sorted name+value pairs", () => {
    const want = createHmac("sha1", TOKEN).update("https://h.example.com/twilio/voiceCallSidCA1From+91").digest("base64");
    expect(twilioSignature({ url: "https://h.example.com/twilio/voice", params: { From: "+91", CallSid: "CA1" }, authToken: TOKEN })).toBe(want);
  });
  it("accepts the right signature and refuses tampering, other tokens, and a missing header", () => {
    const a = { url: "https://h.example.com/twilio/voice", params: { CallSid: "CA1", From: "+91" }, authToken: TOKEN };
    const good = twilioSignature(a);
    expect(verifyTwilioSignature({ ...a, header: good })).toBe(true);
    expect(verifyTwilioSignature({ ...a, header: undefined })).toBe(false);
    expect(verifyTwilioSignature({ ...a, header: "short" })).toBe(false);
    expect(verifyTwilioSignature({ ...a, params: { CallSid: "CA2", From: "+91" }, header: good })).toBe(false);
    expect(verifyTwilioSignature({ ...a, authToken: "other", header: good })).toBe(false);
    expect(verifyTwilioSignature({ ...a, url: "https://evil.example.com/twilio/voice", header: good })).toBe(false);
  });
});

const healthy: TrunkHealthInput = {
  trunkFound: true, terminationDomain: "acme.pstn.twilio.com", credentialLists: 1, ipAccessLists: 0,
  origination: [{ sipUrl: "sip:pbx.example.com", enabled: true, reachable: true }], numbers: 2, callSample: { total: 50, failed: 2 },
};
describe("computeTrunkHealth", () => {
  it("is ok when everything is configured, reachable and calls succeed", () => expect(computeTrunkHealth(healthy).status).toBe("ok"));
  it("is down when the trunk is gone", () => expect(computeTrunkHealth({ ...healthy, trunkFound: false }).status).toBe("down"));
  it("is degraded without outbound auth, without an enabled origination URL, or without numbers", () => {
    expect(computeTrunkHealth({ ...healthy, credentialLists: 0 }).checks.find((c) => c.name === "termination")?.status).toBe("degraded");
    expect(computeTrunkHealth({ ...healthy, terminationDomain: null }).status).toBe("degraded");
    expect(computeTrunkHealth({ ...healthy, origination: [{ sipUrl: "sip:x", enabled: false, reachable: null }] }).status).toBe("degraded");
    expect(computeTrunkHealth({ ...healthy, numbers: 0 }).status).toBe("degraded");
  });
  it("judges reachability: all down is down, some down is degraded, untested is ok", () => {
    const two = [{ sipUrl: "sip:a", enabled: true, reachable: false }, { sipUrl: "sip:b", enabled: true, reachable: true }];
    expect(computeTrunkHealth({ ...healthy, origination: two }).status).toBe("degraded");
    expect(computeTrunkHealth({ ...healthy, origination: [two[0]!] }).status).toBe("down");
    expect(computeTrunkHealth({ ...healthy, origination: [{ sipUrl: "sip:a", enabled: true, reachable: null }] }).status).toBe("ok");
  });
  it("uses the call failure rate only with at least 10 calls", () => {
    expect(computeTrunkHealth({ ...healthy, callSample: { total: 9, failed: 9 } }).status).toBe("ok");
    expect(computeTrunkHealth({ ...healthy, callSample: { total: 10, failed: 2 } }).status).toBe("degraded");
    expect(computeTrunkHealth({ ...healthy, callSample: { total: 10, failed: 5 } }).status).toBe("down");
    expect(computeTrunkHealth({ ...healthy, callSample: null }).status).toBe("ok");
  });
});

describe("SIP endpoint probe", () => {
  it("recognises private addresses and refuses to probe them", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "172.20.1.1", "169.254.169.254", "::1", "fd00::1", "::ffff:10.0.0.1"]) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "2606:4700::1111"]) expect(isPrivateAddress(ip)).toBe(false);
    expect(await probeSipEndpoint("sip:127.0.0.1:5060")).toBe(false);
    expect(await probeSipEndpoint("not a sip url")).toBe(false);
  });
});

describe("Twilio REST", () => {
  const recorder = (reply: (url: string, init: RequestInit) => { status?: number; body?: unknown }) => {
    const seen: Array<{ url: string; method: string; body: string | undefined; headers: Record<string, string> }> = [];
    const fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, method: init.method!, body: init.body as string | undefined, headers: init.headers as Record<string, string> });
      const r = reply(url, init);
      return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
    }) as unknown as typeof globalThis.fetch;
    return { seen, twilio: createTwilio({ accountSid: "AC1", authToken: "tok", fetch }) };
  };

  it("searches local inventory with prices, mapping to the shared number shape", async () => {
    const { seen, twilio } = recorder((url) => url.includes("pricing")
      ? { body: { phone_number_prices: [{ number_type: "local", current_price: "1.15" }, { number_type: "toll free", base_price: "2.15" }] } }
      : { body: { available_phone_numbers: [{ phone_number: "+14155550100", locality: "San Francisco", region: "CA", capabilities: { voice: true, SMS: true, MMS: false }, address_requirements: "none" }] } });
    const r = await twilio.searchNumbers({ countryIso: "us", type: "local", pattern: "415", services: "voice,sms", limit: 5 });
    expect(r).toEqual([{ number: "+14155550100", type: "local", subType: "local", city: "San Francisco", region: "CA", monthlyRentalRate: "1.15", setupRate: null, voiceEnabled: true, smsEnabled: true, restriction: null, restrictionText: null }]);
    const search = seen.find((s) => s.url.includes("AvailablePhoneNumbers"))!;
    expect(search.url).toContain("/2010-04-01/Accounts/AC1/AvailablePhoneNumbers/US/Local.json?PageSize=5&Contains=415&VoiceEnabled=true&SmsEnabled=true");
    expect(search.method).toBe("GET");
    expect(search.headers.authorization).toBe(`Basic ${Buffer.from("AC1:tok").toString("base64")}`);
  });
  it("searches toll-free and flags address requirements", async () => {
    const { seen, twilio } = recorder((url) => url.includes("pricing") ? { status: 404, body: {} } : { body: { available_phone_numbers: [{ phone_number: "+18005550100", capabilities: { voice: true }, address_requirements: "foreign" }] } });
    const r = await twilio.searchNumbers({ countryIso: "US", type: "tollfree" });
    expect(seen.some((s) => s.url.includes("/TollFree.json"))).toBe(true);
    expect(r[0]).toMatchObject({ type: "tollfree", monthlyRentalRate: null, restriction: "foreign", smsEnabled: false });
  });
  it("buys a number with a form-encoded body", async () => {
    const { seen, twilio } = recorder(() => ({ status: 201, body: { sid: "PN1", phone_number: "+14155550100" } }));
    expect(await twilio.buyNumber({ number: "14155550100", voiceUrl: "https://h/voice" })).toEqual({ number: "+14155550100", status: "Success", sid: "PN1" });
    expect(seen[0]!.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(new URLSearchParams(seen[0]!.body).get("PhoneNumber")).toBe("+14155550100");
    expect(new URLSearchParams(seen[0]!.body).get("VoiceUrl")).toBe("https://h/voice");
    expect(new URLSearchParams(seen[0]!.body).has("SmsUrl")).toBe(false);
  });
  it("refuses to treat an unconfirmed purchase as bought", async () => {
    const { twilio } = recorder(() => ({ body: {} }));
    await expect(twilio.buyNumber({ number: "+1415" })).rejects.toThrow(/did not confirm/);
  });
  it("turns a refusal into a readable error", async () => {
    const { twilio } = recorder(() => ({ status: 401, body: { message: "Authenticate" } }));
    await expect(twilio.sendSms({ from: "+1", to: "+2", text: "x" })).rejects.toThrow(/Twilio POST \/2010-04-01\/Accounts\/AC1\/Messages.json failed \(401\): Authenticate/);
  });
  it("creates a trunk, adds origination, IP access and credentials, and attaches a number", async () => {
    const { seen, twilio } = recorder((url) => ({ body: { sid: url.includes("Trunks") && !url.includes("SIP") ? "TK1" : "XX1", friendly_name: "acme", domain_name: "acme.pstn.twilio.com", secure: false } }));
    const t = await twilio.createTrunk({ name: "acme", domainName: "acme.pstn.twilio.com" });
    expect(t).toEqual({ sid: "TK1", name: "acme", domainName: "acme.pstn.twilio.com", secure: false });
    await twilio.addOriginationUrl("TK1", { name: "pbx", sipUrl: "sip:pbx.example.com" });
    await twilio.allowIp("TK1", { name: "pbx", ip: "203.0.113.5", cidrPrefix: 32 });
    await twilio.addCredential("TK1", { name: "pbx", username: "u", password: "Passw0rd!long" });
    await twilio.attachNumber("TK1", "PN1");
    const urls = seen.map((s) => `${s.method} ${s.url.replace(/^https:\/\/[^/]+/, "")}`);
    expect(urls).toEqual([
      "POST /v1/Trunks", "POST /v1/Trunks/TK1/OriginationUrls",
      "POST /2010-04-01/Accounts/AC1/SIP/IpAccessControlLists.json", "POST /2010-04-01/Accounts/AC1/SIP/IpAccessControlLists/XX1/IpAddresses.json", "POST /v1/Trunks/TK1/IpAccessControlLists",
      "POST /2010-04-01/Accounts/AC1/SIP/CredentialLists.json", "POST /2010-04-01/Accounts/AC1/SIP/CredentialLists/XX1/Credentials.json", "POST /v1/Trunks/TK1/CredentialLists",
      "POST /v1/Trunks/TK1/PhoneNumbers",
    ]);
    expect(new URLSearchParams(seen[1]!.body).get("SipUrl")).toBe("sip:pbx.example.com");
  });
  it("reports a missing trunk as null and deletes one", async () => {
    const { seen, twilio } = recorder((_u, init) => (init.method === "GET" ? { status: 404, body: { message: "not found" } } : {}));
    expect(await twilio.getTrunk("TKx")).toBeNull();
    await twilio.deleteTrunk("TKx");
    expect(seen[1]).toMatchObject({ method: "DELETE" });
  });
  it("measures a trunk: configuration, endpoint probe, and the last day's calls", async () => {
    const { twilio } = recorder((url) => {
      if (url.endsWith("/Trunks/TK1")) return { body: { sid: "TK1", friendly_name: "a", domain_name: "a.pstn.twilio.com" } };
      if (url.includes("OriginationUrls")) return { body: { origination_urls: [{ sid: "OU1", friendly_name: "p", sip_url: "sip:pbx.example.com", enabled: true }] } };
      if (url.includes("CredentialLists")) return { body: { credential_lists: [{ sid: "CL1" }] } };
      if (url.includes("IpAccessControlLists")) return { body: { ip_access_control_lists: [] } };
      if (url.includes("PhoneNumbers")) return { body: { phone_numbers: [{ sid: "PN1" }] } };
      if (url.includes("Calls.json")) return { body: { calls: [...Array(10)].map((_, i) => ({ trunk_sid: "TK1", status: i < 6 ? "failed" : "completed" })).concat([{ trunk_sid: "OTHER", status: "failed" }]) } };
      return {};
    });
    const h = await twilio.trunkHealth("TK1", { probe: async () => true, now: new Date("2026-11-20T10:00:00Z") });
    expect(h.status).toBe("down"); // 6 of the 10 trunk calls failed
    expect(h.checks.find((c) => c.name === "calls")?.status).toBe("down");
    expect(h.checks.find((c) => c.name === "origination")?.status).toBe("ok");
    expect(h.checkedAt).toBe("2026-11-20T10:00:00.000Z");
  });
});
