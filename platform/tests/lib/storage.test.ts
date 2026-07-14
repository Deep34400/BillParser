import { describe, it, expect } from 'vitest';
import { isPdf, isImage } from '../../src/lib/storage.js';

describe('storage helpers', () => {
  describe('isPdf', () => {
    it('detects PDF magic bytes', () => {
      const pdf = Buffer.from('%PDF-1.4 content');
      expect(isPdf(pdf)).toBe(true);
    });

    it('rejects non-PDF', () => {
      const txt = Buffer.from('Hello world');
      expect(isPdf(txt)).toBe(false);
    });

    it('rejects empty buffer', () => {
      expect(isPdf(Buffer.alloc(0))).toBe(false);
    });
  });

  describe('isImage', () => {
    it('detects JPEG magic bytes', () => {
      const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(isImage(jpg)).toBe(true);
    });

    it('detects PNG magic bytes', () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
      expect(isImage(png)).toBe(true);
    });

    it('rejects non-image', () => {
      const txt = Buffer.from('Not an image');
      expect(isImage(txt)).toBe(false);
    });
  });
});
