import { describe, expect, it } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { S3Recordings, SIGNED_LINK_SECONDS } from "./s3-recordings";

const cfg = { bucket: "voiceai-recordings", region: "ap-south-1" };
const KEY = "rec/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.m4a";

describe("S3Recordings", () => {
  it("stores with KMS encryption in the right bucket", async () => {
    const sent: { name: string; input: Record<string, unknown> }[] = [];
    const s3 = new S3Recordings(cfg, { send: async (c: { constructor: { name: string }; input: Record<string, unknown> }) => { sent.push({ name: c.constructor.name, input: c.input }); return {}; } } as never);
    await s3.put(KEY, new Uint8Array([1, 2, 3]), "audio/mp4");
    expect(sent[0]!.name).toBe("PutObjectCommand");
    expect(sent[0]!.input).toMatchObject({ Bucket: "voiceai-recordings", Key: KEY, ServerSideEncryption: "aws:kms", ContentType: "audio/mp4" });
  });

  it("deletes by key", async () => {
    const sent: string[] = [];
    const s3 = new S3Recordings(cfg, { send: async (c: { constructor: { name: string } }) => { sent.push(c.constructor.name); return {}; } } as never);
    await s3.remove(KEY);
    expect(sent).toEqual(["DeleteObjectCommand"]);
  });

  it("signs a link that expires in five minutes, offline", async () => {
    const client = new S3Client({ region: cfg.region, credentials: { accessKeyId: "AKIATEST", secretAccessKey: "secret" } });
    const url = new URL(await new S3Recordings(cfg, client).signedUrl(KEY));
    expect(url.hostname).toBe("voiceai-recordings.s3.ap-south-1.amazonaws.com");
    expect(url.pathname).toBe(`/${KEY}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe(String(SIGNED_LINK_SECONDS));
    expect(SIGNED_LINK_SECONDS).toBe(300);
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("response-cache-control")).toBe("private, no-store");
  });
});
