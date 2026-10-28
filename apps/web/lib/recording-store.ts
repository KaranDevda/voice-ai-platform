import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { S3Recordings } from "@voiceai/providers";

/**
 * Where call recordings are kept. With RECORDINGS_BUCKET set: a private, KMS-encrypted S3 bucket, played through 5-minute signed
 * links (RECORDINGS_REGION, default ap-south-1; RECORDINGS_S3_ENDPOINT only for a local stand-in). Otherwise a folder on this
 * machine (RECORDINGS_DIR, default .local/recordings, never committed). A recording is personal data: it is only handed out by
 * the route that checks the caller's access.
 */
export const MAX_RECORDING_BYTES = 50 * 1024 * 1024;
export const RECORDING_TYPES: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/amr": "amr", "audio/3gpp": "3gp",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm",
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(RECORDING_TYPES).reverse().map(([m, e]) => [e, m]));

const root = () => resolve(process.env.RECORDINGS_DIR?.trim() || resolve(process.cwd(), "../../.local/recordings"));
/** Keys are built by us (org / call id / extension), but are still checked so a key can never point outside the folder. */
const pathFor = (key: string) => {
  const p = resolve(root(), key);
  if (!p.startsWith(root() + sep) || !KEY_SHAPE.test(key)) throw new Error("bad recording key");
  return p;
};

let s3: S3Recordings | null | undefined;
const bucket = () => (s3 === undefined ? (s3 = process.env.RECORDINGS_BUCKET?.trim() ? new S3Recordings({ bucket: process.env.RECORDINGS_BUCKET.trim(), region: process.env.RECORDINGS_REGION?.trim() || "ap-south-1", endpoint: process.env.RECORDINGS_S3_ENDPOINT?.trim() || undefined }) : null) : s3);
const checkKey = (key: string) => { if (!KEY_SHAPE.test(key)) throw new Error("bad recording key"); };
const KEY_SHAPE = /^rec\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.[a-z0-9]{2,4}$/;

export const recordingKey = (orgId: string, callLogId: string, mime: string) => `rec/${orgId}/${callLogId}.${RECORDING_TYPES[mime]}`;

export async function putRecording(key: string, data: Uint8Array): Promise<void> {
  const remote = bucket();
  if (remote) { checkKey(key); return remote.put(key, data, MIME_BY_EXT[key.split(".").pop() ?? ""] ?? "application/octet-stream"); }
  const p = pathFor(key);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, data, { mode: 0o600 });
}

/** A five-minute link to the stored audio, or null when recordings are kept on this machine (then use getRecording). */
export async function recordingLink(key: string): Promise<string | null> {
  const remote = bucket();
  if (!remote) return null;
  checkKey(key);
  return remote.signedUrl(key);
}

export async function getRecording(key: string): Promise<{ data: Buffer; mime: string } | null> {
  try { return { data: await readFile(pathFor(key)), mime: MIME_BY_EXT[key.split(".").pop() ?? ""] ?? "application/octet-stream" }; }
  catch { return null; }
}

/** Removes a stored recording. A missing file is fine: the goal is that it is gone. */
export async function deleteRecording(key: string): Promise<void> {
  const remote = bucket();
  if (remote) { checkKey(key); return remote.remove(key); }
  try { await rm(pathFor(key), { force: true }); } catch { /* a malformed key points at nothing we own */ }
}
