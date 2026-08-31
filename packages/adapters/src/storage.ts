import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import type { AppConfig } from '@everecho/config';

export interface StoredObject {
  key: string;
  byteSize: number;
  checksumSha256: string;
}

export interface SignedUrl {
  url: string;
  method: 'GET' | 'PUT';
  headers: Record<string, string>;
  expiresAt: string;
}

/**
 * Object storage. Originals are immutable and buckets are private; nothing is
 * ever served from a public URL, only through short-lived signed links that are
 * issued after authorize() has allowed the access.
 */
export interface StorageAdapter {
  readonly name: string;
  put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<{ byteSize: number } | null>;
  delete(key: string): Promise<void>;
  signDownload(key: string, ttlSeconds: number): Promise<SignedUrl>;
  signUpload(key: string, contentType: string, ttlSeconds: number): Promise<SignedUrl>;
  /** Verifies a signature produced by signDownload/signUpload. */
  verifySignature(params: { key: string; expires: number; op: 'get' | 'put'; signature: string }): boolean;
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Filesystem storage for development and tests. Signed URLs are HMAC-signed and
 * expiring, and are served by the API rather than by a static file server, so
 * the local path exercises the same authorisation and audit code as S3.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly name = 'local';
  private readonly root: string;
  private readonly secret: string;
  private readonly baseUrl: string;

  constructor(cfg: AppConfig) {
    this.root = resolve(cfg.env.STORAGE_LOCAL_DIR);
    this.secret = cfg.env.STORAGE_SIGNING_SECRET;
    this.baseUrl = cfg.env.API_PUBLIC_URL.replace(/\/$/, '');
  }

  /** Refuses any key that would escape the storage root. */
  private pathFor(key: string): string {
    const clean = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    const full = resolve(join(this.root, clean));
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error('Refusing a storage key that escapes the storage root');
    }
    return full;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<StoredObject> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return { key, byteSize: body.byteLength, checksumSha256: sha256(body) };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async head(key: string): Promise<{ byteSize: number } | null> {
    try {
      const s = await stat(this.pathFor(key));
      return { byteSize: s.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  private sign(key: string, expires: number, op: 'get' | 'put'): string {
    return createHmac('sha256', this.secret).update(`${op}:${key}:${expires}`).digest('hex');
  }

  private signed(key: string, ttlSeconds: number, op: 'get' | 'put'): SignedUrl {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const signature = this.sign(key, expires, op);
    const qs = new URLSearchParams({ key, expires: String(expires), signature });
    return {
      url: `${this.baseUrl}/v1/objects/${op}?${qs.toString()}`,
      method: op === 'get' ? 'GET' : 'PUT',
      headers: {},
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  async signDownload(key: string, ttlSeconds: number): Promise<SignedUrl> {
    return this.signed(key, ttlSeconds, 'get');
  }

  async signUpload(key: string, _contentType: string, ttlSeconds: number): Promise<SignedUrl> {
    return this.signed(key, ttlSeconds, 'put');
  }

  verifySignature({
    key,
    expires,
    op,
    signature,
  }: {
    key: string;
    expires: number;
    op: 'get' | 'put';
    signature: string;
  }): boolean {
    if (!Number.isFinite(expires) || expires * 1000 < Date.now()) return false;
    const expected = Buffer.from(this.sign(key, expires, op));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }
}

/**
 * S3-compatible storage (AWS S3, MinIO, Cloudflare R2). The SDK is imported
 * lazily so that a deployment using local storage never loads it.
 *
 * UNVERIFIED in this build: no S3 endpoint or credentials were available to
 * exercise it. The interface and configuration are complete; see
 * docs/DEPLOYMENT.md for the settings required to switch over.
 */
export class S3StorageAdapter implements StorageAdapter {
  readonly name = 's3';
  private client: unknown;

  constructor(private readonly cfg: AppConfig) {}

  private async sdk() {
    const mod = await import('@aws-sdk/client-s3');
    this.client ??= new mod.S3Client({
      region: this.cfg.env.S3_REGION,
      endpoint: this.cfg.env.S3_ENDPOINT,
      forcePathStyle: this.cfg.env.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: this.cfg.env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: this.cfg.env.S3_SECRET_ACCESS_KEY ?? '',
      },
    });
    return { mod, client: this.client as InstanceType<typeof mod.S3Client> };
  }

  private get bucket(): string {
    const bucket = this.cfg.env.S3_BUCKET;
    if (!bucket) throw new Error('S3_BUCKET is not configured');
    return bucket;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const { mod, client } = await this.sdk();
    await client.send(
      new mod.PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return { key, byteSize: body.byteLength, checksumSha256: sha256(body) };
  }

  async get(key: string): Promise<Buffer> {
    const { mod, client } = await this.sdk();
    const result = await client.send(new mod.GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) throw new Error(`Object ${key} has no body`);
    return Buffer.from(bytes);
  }

  async head(key: string): Promise<{ byteSize: number } | null> {
    const { mod, client } = await this.sdk();
    try {
      const result = await client.send(new mod.HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { byteSize: result.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const { mod, client } = await this.sdk();
    await client.send(new mod.DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async signDownload(key: string, ttlSeconds: number): Promise<SignedUrl> {
    const { mod, client } = await this.sdk();
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const url = await getSignedUrl(
      client,
      new mod.GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: ttlSeconds },
    );
    return {
      url,
      method: 'GET',
      headers: {},
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  async signUpload(key: string, contentType: string, ttlSeconds: number): Promise<SignedUrl> {
    const { mod, client } = await this.sdk();
    const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');
    const url = await getSignedUrl(
      client,
      new mod.PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: ttlSeconds },
    );
    return {
      url,
      method: 'PUT',
      headers: { 'content-type': contentType },
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    };
  }

  /** S3 verifies its own presigned URLs; nothing reaches our routes to check. */
  verifySignature(): boolean {
    return false;
  }
}

export function createStorage(cfg: AppConfig): StorageAdapter {
  return cfg.env.STORAGE_DRIVER === 's3' ? new S3StorageAdapter(cfg) : new LocalStorageAdapter(cfg);
}

/** Storage keys never contain a filename: filenames are memory-adjacent content. */
export function storageKeyFor(parts: {
  archiveId: string;
  sourceId: string;
  kind: 'quarantine' | 'original' | 'derived' | 'export';
  version?: number;
}): string {
  const suffix = parts.version === undefined ? '' : `/v${parts.version}`;
  return `archives/${parts.archiveId}/${parts.kind}/${parts.sourceId}${suffix}`;
}
