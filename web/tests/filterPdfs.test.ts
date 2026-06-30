import { describe, it, expect } from 'vitest';
import { filterPdfs } from '../src/pages/InvoicesPage.js';

const mk = (name: string, type: string) => new File([new Uint8Array([1])], name, { type });

describe('filterPdfs', () => {
  it('keeps PDFs identified by MIME type', () => {
    expect(filterPdfs([mk('a.pdf', 'application/pdf')]).map((f) => f.name)).toEqual(['a.pdf']);
  });
  it('keeps PDFs by .pdf extension when the MIME type is empty or wrong', () => {
    const out = filterPdfs([mk('invoice.pdf', ''), mk('SCAN.PDF', 'application/octet-stream')]);
    expect(out.map((f) => f.name)).toEqual(['invoice.pdf', 'SCAN.PDF']);
  });
  it('drops non-PDF files', () => {
    expect(filterPdfs([mk('notes.txt', 'text/plain'), mk('img.png', 'image/png')]).length).toBe(0);
  });
  it('filters a mixed selection, keeping only PDFs', () => {
    const out = filterPdfs([mk('x.pdf', 'application/pdf'), mk('y.doc', 'application/msword'), mk('z.pdf', '')]);
    expect(out.map((f) => f.name)).toEqual(['x.pdf', 'z.pdf']);
  });
});
