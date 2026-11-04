import { describe, expect, it } from "vitest";
import { assertPublicUrl, isPrivateIp, sendCrmWebhook, verifyCrmSignature } from "./crm-webhook";

describe("webhook address safety", () => {
  it("knows private and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.2", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1"]) expect(isPrivateIp(ip)).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111"]) expect(isPrivateIp(ip)).toBe(false);
  });
  it("accepts only https addresses that resolve to public IPs", async () => {
    const pub = async () => ["93.184.216.34"], priv = async () => ["93.184.216.34", "10.0.0.5"];
    await expect(assertPublicUrl("https://crm.example.com/hook", pub)).resolves.toBeInstanceOf(URL);
    for (const bad of ["http://crm.example.com", "https://localhost/x", "https://a.local/x", "https://user:pw@crm.example.com", "https://127.0.0.1/x", "https://[::1]/x", "https://169.254.169.254/latest", "not a url"]) await expect(assertPublicUrl(bad, pub)).rejects.toThrow();
    await expect(assertPublicUrl("https://sneaky.example.com", priv)).rejects.toThrow(/private/);
  });
});

describe("signed delivery", () => {
  it("signs the timestamp and body, and the receiver can verify it", async () => {
    let seen: { headers: Record<string, string>; body: string } | undefined;
    const r = await sendCrmWebhook({ id: "d1", event: "lead.created", payload: { a: 1 }, url: "https://crm.example.com/h", secret: "whsec_x" }, {
      resolve: async () => ["93.184.216.34"], now: () => 1_700_000_000_000,
      fetch: (async (_u: string, init: any) => { seen = { headers: init.headers, body: init.body }; return new Response("ok", { status: 200 }); }) as any,
    });
    expect(r).toEqual({ ok: true, status: 200, error: null });
    expect(seen!.headers["x-voiceai-event"]).toBe("lead.created");
    expect(verifyCrmSignature(seen!.body, seen!.headers["x-voiceai-timestamp"], seen!.headers["x-voiceai-signature"], "whsec_x", 1_700_000_010)).toBe(true);
    expect(verifyCrmSignature(seen!.body + " ", seen!.headers["x-voiceai-timestamp"], seen!.headers["x-voiceai-signature"], "whsec_x", 1_700_000_010)).toBe(false);
    expect(verifyCrmSignature(seen!.body, seen!.headers["x-voiceai-timestamp"], seen!.headers["x-voiceai-signature"], "whsec_x", 1_700_009_000)).toBe(false);
  });
  it("reports failures plainly and never sends to a private address", async () => {
    const f = (async () => new Response("no", { status: 500 })) as any;
    expect((await sendCrmWebhook({ id: "d", event: "e", payload: {}, url: "https://crm.example.com/h", secret: "s" }, { resolve: async () => ["93.184.216.34"], fetch: f })).error).toMatch(/500/);
    let called = false;
    const r = await sendCrmWebhook({ id: "d", event: "e", payload: {}, url: "https://evil.example.com/h", secret: "s" }, { resolve: async () => ["169.254.169.254"], fetch: (async () => { called = true; return new Response(""); }) as any });
    expect(r.ok).toBe(false); expect(called).toBe(false);
    expect((await sendCrmWebhook({ id: "d", event: "e", payload: {}, url: "https://crm.example.com/h", secret: "s" }, { resolve: async () => ["93.184.216.34"], fetch: (async () => new Response("", { status: 302 })) as any })).error).toMatch(/redirect/);
  });
});
