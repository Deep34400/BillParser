/**
 * Expand a zip of invoices. Only PDF / JPEG / PNG / WebP are kept.
 * Nested zips and junk paths (__MACOSX, directories) are rejected.
 */
import { inflateRawSync } from 'zlib';
import { isPdf, isImage } from '../../shared/storage.js';

export interface ZipFile {
  buf: Buffer;
  name: string;
}

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;

export function isZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b
    && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
}

function readU16(buf: Buffer, offset: number): number {
  return buf.readUInt16LE(offset);
}

function readU32(buf: Buffer, offset: number): number {
  return buf.readUInt32LE(offset);
}

function isJunkPath(name: string): boolean {
  const n = name.replace(/\\/g, '/');
  if (n.endsWith('/')) return true;
  if (n.startsWith('__MACOSX/') || n.includes('/__MACOSX/')) return true;
  const base = n.split('/').pop() ?? n;
  return base.startsWith('.') || base === 'Thumbs.db';
}

export function expandZip(buf: Buffer): {
  files: ZipFile[];
  rejected: { name: string; reason: string }[];
} {
  const files: ZipFile[] = [];
  const rejected: { name: string; reason: string }[] = [];
  let offset = 0;

  while (offset + 30 <= buf.length) {
    const sig = readU32(buf, offset);
    if (sig === CENTRAL_SIG) break;
    if (sig !== LOCAL_SIG) {
      if (files.length === 0 && rejected.length === 0) {
        rejected.push({ name: '(zip)', reason: 'Not a valid zip archive' });
      }
      break;
    }

    const flags = readU16(buf, offset + 6);
    const method = readU16(buf, offset + 8);
    const compressedSize = readU32(buf, offset + 18);
    const uncompressedSize = readU32(buf, offset + 22);
    const nameLen = readU16(buf, offset + 26);
    const extraLen = readU16(buf, offset + 28);
    const nameStart = offset + 30;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString('utf8');
    const dataStart = nameStart + nameLen + extraLen;

    if (flags & 0x08) {
      rejected.push({ name, reason: 'Zip entry uses data descriptor — re-zip without streaming' });
      break;
    }

    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buf.length) {
      rejected.push({ name, reason: 'Truncated zip entry' });
      break;
    }

    offset = dataEnd;

    if (isJunkPath(name)) continue;

    let entry: Buffer;
    try {
      const raw = buf.subarray(dataStart, dataEnd);
      if (method === 0) entry = Buffer.from(raw);
      else if (method === 8) entry = inflateRawSync(raw);
      else {
        rejected.push({ name, reason: `Unsupported zip compression (${method})` });
        continue;
      }
    } catch {
      rejected.push({ name, reason: 'Could not inflate zip entry' });
      continue;
    }

    if (uncompressedSize && entry.length !== uncompressedSize) {
      rejected.push({ name, reason: 'Zip entry size mismatch' });
      continue;
    }

    if (isZip(entry)) {
      rejected.push({ name, reason: 'Nested zip is not allowed' });
      continue;
    }

    if (!isPdf(entry) && !isImage(entry)) {
      rejected.push({ name, reason: 'Unsupported type — only PDF or JPEG/PNG/WebP' });
      continue;
    }

    const fileName = name.split('/').pop() || name;
    files.push({ buf: entry, name: fileName });
  }

  return { files, rejected };
}
