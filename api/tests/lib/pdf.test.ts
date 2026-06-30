import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { isPdf, pageCount } from '../../src/lib/pdf.js';
it('detects pdf magic bytes', async () => {
  const doc = await PDFDocument.create(); doc.addPage(); doc.addPage();
  const bytes = Buffer.from(await doc.save());
  expect(isPdf(bytes)).toBe(true);
  expect(isPdf(Buffer.from('not a pdf'))).toBe(false);
  expect(await pageCount(bytes)).toBe(2);
});
