import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { htmlToKnowledgeText } from "@voiceai/shared";

const MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 8_000;

function publicAddress(address: string) {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split(".").map(Number);
    const a = octets[0]!;
    const b = octets[1]!;
    const c = octets[2]!;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && ((b === 18 || b === 19) || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113));
  }
  if (version === 6) {
    const normalized = address.toLowerCase().split("%", 1)[0]!;
    // Only globally routed unicast IPv6 is accepted. Reject mapped and special-use ranges too.
    return /^(2|3)[0-9a-f]{0,3}:/i.test(normalized) && !normalized.startsWith("2001:db8:") &&
      !normalized.startsWith("2001:10:") && !normalized.startsWith("2002:") && !normalized.startsWith("3fff:");
  }
  return false;
}

async function validateUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("Enter a valid public website URL."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || !url.hostname || isIP(url.hostname)) {
    throw new Error("Only public HTTP or HTTPS website URLs are supported.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("Only public HTTP or HTTPS website URLs are supported.");
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true }) as Array<{ address: string; family: 4 | 6 }>;
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) {
    throw new Error("This website resolves to a non-public address and cannot be imported.");
  }
  return { url, addresses };
}

function getPage(url: URL, addresses: Array<{ address: string; family: 4 | 6 }>): Promise<{ status: number; location?: string; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    let addressIndex = 0;
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = transport(url, {
      method: "GET",
      headers: { accept: "text/html, text/plain;q=0.9", "user-agent": "VoiceAI-KnowledgeImporter/1.0" },
      // Pin the socket to an address we validated, preventing a second DNS lookup from reaching a private host.
      lookup: (_hostname, _options, callback) => {
        const candidate = addresses[addressIndex++ % addresses.length]!;
        callback(null, candidate.address, candidate.family);
      },
    }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      const type = String(response.headers["content-type"] ?? "").toLowerCase();
      if (status >= 300 && status < 400 && location) {
        response.resume();
        resolve({ status, location, type, body: "" });
        return;
      }
      if (status < 200 || status >= 300) {
        response.resume();
        reject(new Error(`Website returned HTTP ${status || "error"}.`));
        return;
      }
      if (!type.includes("text/html") && !type.includes("application/xhtml+xml") && !type.includes("text/plain")) {
        response.resume();
        reject(new Error("That URL does not serve an HTML or plain-text page."));
        return;
      }
      const length = Number(response.headers["content-length"]);
      if (Number.isFinite(length) && length > MAX_BYTES) {
        response.destroy(new Error("The page is larger than 1 MB."));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (part: Buffer) => {
        bytes += part.length;
        if (bytes > MAX_BYTES) {
          response.destroy(new Error("The page is larger than 1 MB."));
          return;
        }
        chunks.push(part);
      });
      response.on("end", () => resolve({ status, type, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.setTimeout(TIMEOUT_MS, () => request.destroy(new Error("The website took too long to respond.")));
    request.on("error", reject);
    request.end();
  });
}

export async function importKnowledgeUrl(source: string): Promise<{ title: string; text: string; url: string }> {
  let current = source;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    const { url, addresses } = await validateUrl(current);
    const page = await getPage(url, addresses);
    if (page.location) {
      if (redirect === MAX_REDIRECTS) throw new Error("The website redirected too many times.");
      current = new URL(page.location, url).toString();
      continue;
    }
    const text = page.type.includes("text/plain") ? page.body.trim() : htmlToKnowledgeText(page.body);
    if (!text) throw new Error("No readable text was found on that page.");
    const titleMatch = page.body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
    const title = htmlToKnowledgeText(titleMatch?.[1] ?? "") || url.hostname;
    return { title: title.slice(0, 200), text, url: url.toString() };
  }
  throw new Error("Could not import that website.");
}
