import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** A recording link stops working after five minutes (SOP). */
export const SIGNED_LINK_SECONDS = 300;

export interface S3RecordingsConfig {
  bucket: string;
  region: string;
  /** Only for a local S3 stand-in (MinIO) in development. */
  endpoint?: string;
}

/**
 * Recordings in a private S3 bucket, encrypted with the bucket's KMS key. The bucket is never public: a person gets audio only
 * through a short-lived signed link, and only after the web route has checked their access and written the audit row.
 * `client` can be replaced in tests.
 */
export class S3Recordings {
  constructor(private readonly cfg: S3RecordingsConfig, private readonly client: Pick<S3Client, "send"> & Partial<Pick<S3Client, "config">> = new S3Client({ region: cfg.region, ...(cfg.endpoint ? { endpoint: cfg.endpoint, forcePathStyle: true } : {}) })) {}

  async put(key: string, data: Uint8Array, mime: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: data, ContentType: mime, ServerSideEncryption: "aws:kms" }));
  }

  /** A deleted or missing object is the same outcome: it is gone. */
  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  /** The link the browser plays from. `expiresIn` is for tests; real callers use the five-minute default. */
  async signedUrl(key: string, expiresIn = SIGNED_LINK_SECONDS): Promise<string> {
    return getSignedUrl(this.client as S3Client, new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key, ResponseContentDisposition: "inline", ResponseCacheControl: "private, no-store" }), { expiresIn });
  }
}
