import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import { rasterizePdf } from '../../src/lib/rasterize.js';

const exec = promisify(execFile);
// Present even if it exits non-zero (usage error); only ENOENT means "not installed".
async function hasPdftoppm(): Promise<boolean> {
  try { await exec('pdftoppm', ['-h']); return true; }
  catch (e: any) { return e?.code !== 'ENOENT'; }
}

async function onePagePdf(): Promise<Buffer> {
  const d = await PDFDocument.create();
  d.addPage();
  return Buffer.from(await d.save());
}

describe('rasterizePdf', () => {
  it('rejects non-PDF input', async () => {
    await expect(rasterizePdf(Buffer.from('not a pdf'))).rejects.toThrow(/not a PDF/i);
  });

  it('renders a PDF to base64 PNG pages', async () => {
    if (!(await hasPdftoppm())) {
      console.warn('skipping: pdftoppm not installed on host');
      return;
    }
    const pages = await rasterizePdf(await onePagePdf());
    expect(pages.length).toBeGreaterThanOrEqual(1);
    const png = Buffer.from(pages[0], 'base64');
    // PNG magic bytes
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});
