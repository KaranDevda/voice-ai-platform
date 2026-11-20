import { describe, expect, it } from "vitest";
import { AdminError } from "./platform-admin";
import { checkSipUrl, checkTrunkName } from "./sip-trunks";

describe("SIP address check", () => {
  it("accepts sip: and sips: addresses with a public host, user, port and parameters", () => {
    for (const ok of ["sip:pbx.example.com", "sips:sbc.example.com:5061", "sip:in@carrier.example.net:5060;transport=tcp", "sip:203.0.113.9", "  sip:a.b.co  "]) expect(() => checkSipUrl(ok)).not.toThrow();
    expect(checkSipUrl("  sip:a.b.co ")).toBe("sip:a.b.co");
  });
  it("refuses anything else, and addresses inside a private network", () => {
    for (const bad of ["", "pbx.example.com", "http://pbx.example.com", "sip:", "sip:a b.com", "tel:+911234567890", "sip:" + "a".repeat(300) + ".com"]) expect(() => checkSipUrl(bad), bad).toThrow(AdminError);
    for (const priv of ["sip:localhost", "sip:127.0.0.1", "sip:10.0.0.4:5060", "sip:192.168.1.2", "sip:172.16.0.1", "sip:169.254.169.254", "sip:pbx.internal", "sip:u@printer.local"]) expect(() => checkSipUrl(priv), priv).toThrow(/private network/);
  });
});

describe("trunk name check", () => {
  it("accepts ordinary names and trims", () => expect(checkTrunkName("  Mumbai  PBX-1 ")).toBe("Mumbai PBX-1"));
  it("refuses empty, long and odd names", () => {
    for (const bad of ["", "   ", "x".repeat(61), "a/b", "<script>", 5]) expect(() => checkTrunkName(bad)).toThrow(AdminError);
  });
});
