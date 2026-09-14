import { describe, expect, it } from 'vitest';
import { inflateRawSync, deflateRawSync } from 'zlib';
import { expandZip, isZip } from '../../../src/ocr/service/expandZip.js';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function storedZip(name: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(name);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + nameBuf.length, 12);
  eocd.writeUInt32LE(30 + nameBuf.length + data.length, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}

function deflatedZip(name: string, data: Buffer): Buffer {
  const compressed = deflateRawSync(data);
  const nameBuf = Buffer.from(name);
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 8);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + nameBuf.length, 12);
  eocd.writeUInt32LE(30 + nameBuf.length + compressed.length, 16);
  return Buffer.concat([local, nameBuf, compressed, central, nameBuf, eocd]);
}

describe('expandZip', () => {
  it('detects zip magic', () => {
    expect(isZip(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(isZip(Buffer.from('%PDF-'))).toBe(false);
  });

  it('keeps a stored PDF and skips junk', () => {
    const pdf = Buffer.from('%PDF-1.4 fake');
    const zip = storedZip('invoices/a.pdf', pdf);
    const { files, rejected } = expandZip(zip);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('a.pdf');
    expect(rejected).toHaveLength(0);
  });

  it('inflates deflated PDF entries', () => {
    const pdf = Buffer.from('%PDF-1.4 deflated');
    const zip = deflatedZip('b.pdf', pdf);
    const { files } = expandZip(zip);
    expect(files[0].buf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('rejects nested zip', () => {
    const inner = storedZip('a.pdf', Buffer.from('%PDF-1.4 x'));
    const outer = storedZip('inner.zip', inner);
    const { files, rejected } = expandZip(outer);
    expect(files).toHaveLength(0);
    expect(rejected[0].reason).toMatch(/Nested zip/);
  });

  it('round-trips inflate helper used by the test', () => {
    const raw = Buffer.from('hello');
    expect(inflateRawSync(deflateRawSync(raw)).toString()).toBe('hello');
  });
});
