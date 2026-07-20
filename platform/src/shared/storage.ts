/**
 * File storage — LOCAL_DEV in-memory, or private GCS with signed URLs.
 * Bucket objects are NEVER made public.
 */
import { storage } from '../config/firebase.js';
import { env } from '../config/env.js';
import { devStore } from './devStore.js';
import { v4 as uuid } from 'uuid';

/**
 * Upload a file buffer.
 * Returns { storagePath, publicUrl } — publicUrl is a private reference (gs:// or local://),
 * not a public internet URL. Use getSignedReadUrl() or GET /api/invoices/:id/file to read.
 */
export async function uploadFile(
  buf: Buffer,
  opts: { fileName?: string; contentType?: string } = {},
): Promise<{ storagePath: string; publicUrl: string }> {
  const ext = (opts.fileName ?? 'file').split('.').pop() ?? 'pdf';
  const datePath = new Date().toISOString().slice(0, 10);
  const storagePath = `bills/${datePath}/${uuid()}.${ext}`;

  if (env.localDev) {
    devStore.files.set(storagePath, {
      buf,
      contentType: opts.contentType ?? 'application/pdf',
    });
    return {
      storagePath,
      publicUrl: `local://${storagePath}`,
    };
  }

  const bucket = storage().bucket(env.storageBucket);
  const file = bucket.file(storagePath);
  // Do NOT set predefinedAcl — buckets with Uniform Bucket-Level Access reject legacy ACLs.
  // Objects are private by default when the bucket is not public.
  await file.save(buf, {
    resumable: false,
    metadata: {
      contentType: opts.contentType ?? 'application/pdf',
      metadata: { originalName: opts.fileName ?? 'unknown' },
    },
  });

  return {
    storagePath,
    publicUrl: `gs://${env.storageBucket}/${storagePath}`,
  };
}

/**
 * V4 signed read URL for a private GCS object.
 * Needs a service account that can sign (SA JSON key, or Cloud Run SA with signBlob).
 * User ADC from `gcloud auth application-default login` often cannot sign — returns null then.
 */
export async function getSignedReadUrl(
  storagePath: string,
  ttlMinutes = env.signedUrlTtlMinutes,
): Promise<string | null> {
  if (env.localDev) return null;
  try {
    const bucket = storage().bucket(env.storageBucket);
    const file = bucket.file(storagePath);
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + Math.max(1, ttlMinutes) * 60_000,
    });
    return url;
  } catch (err) {
    console.warn(
      `[storage] signed URL failed for ${storagePath}:`,
      err instanceof Error ? err.message : err,
      '— falling back to API proxy stream',
    );
    return null;
  }
}

/**
 * Download a file from Cloud Storage or an external URL.
 */
export async function downloadFile(source: string): Promise<Buffer> {
  if (source.startsWith('gs://') || source.startsWith(`https://storage.googleapis.com/${env.storageBucket}`)) {
    const path = source.startsWith('gs://')
      ? source.replace(`gs://${env.storageBucket}/`, '')
      : source.replace(`https://storage.googleapis.com/${env.storageBucket}/`, '');
    const bucket = storage().bucket(env.storageBucket);
    const [buf] = await bucket.file(path).download();
    return buf;
  }

  const resp = await fetch(source);
  if (!resp.ok) throw new Error(`Failed to fetch ${source}: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

export function isPdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString() === '%PDF-';
}

export function isImage(buf: Buffer): boolean {
  if (buf[0] === 0xff && buf[1] === 0xd8) return true;
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG') return true;
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return true;
  return false;
}

/**
 * Read an uploaded file by storage path (LOCAL_DEV or private GCS).
 */
export async function getStoredFile(storagePath: string): Promise<{ buf: Buffer; contentType: string } | null> {
  if (env.localDev) {
    return devStore.files.get(storagePath) ?? null;
  }
  const path = storagePath
    .replace(/^gs:\/\/[^/]+\//, '')
    .replace(/^local:\/\//, '');
  const bucket = storage().bucket(env.storageBucket);
  const file = bucket.file(path);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  const [meta] = await file.getMetadata();
  return {
    buf,
    contentType: meta.contentType ?? 'application/pdf',
  };
}
