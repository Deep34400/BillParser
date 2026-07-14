import { storage } from '../config/firebase.js';
import { env } from '../config/env.js';
import { devStore } from './devStore.js';
import { v4 as uuid } from 'uuid';

/**
 * Upload a file buffer to Cloud Storage.
 * Returns { storagePath, publicUrl }.
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
  await file.save(buf, {
    metadata: {
      contentType: opts.contentType ?? 'application/pdf',
      metadata: { originalName: opts.fileName ?? 'unknown' },
    },
  });

  const publicUrl = `https://storage.googleapis.com/${env.storageBucket}/${storagePath}`;
  return { storagePath, publicUrl };
}

/**
 * Download a file from Cloud Storage or an external URL.
 * Returns the file as a Buffer.
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

  // External URL (S3, HTTPS, etc.)
  const resp = await fetch(source);
  if (!resp.ok) throw new Error(`Failed to fetch ${source}: ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

/** Detect if a buffer is a PDF. */
export function isPdf(buf: Buffer): boolean {
  return buf.length >= 5 && buf.subarray(0, 5).toString() === '%PDF-';
}

/** Detect if a buffer is an image. */
export function isImage(buf: Buffer): boolean {
  if (buf[0] === 0xff && buf[1] === 0xd8) return true;  // JPEG
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG') return true;  // PNG
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return true;
  return false;
}

/**
 * Read an uploaded file by storage path (LOCAL_DEV or GCS).
 */
export async function getStoredFile(storagePath: string): Promise<{ buf: Buffer; contentType: string } | null> {
  if (env.localDev) {
    return devStore.files.get(storagePath) ?? null;
  }
  const bucket = storage().bucket(env.storageBucket);
  const file = bucket.file(storagePath);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [buf] = await file.download();
  const [meta] = await file.getMetadata();
  return {
    buf,
    contentType: meta.contentType ?? 'application/pdf',
  };
}
