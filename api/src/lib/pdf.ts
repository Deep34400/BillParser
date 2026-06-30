import { PDFDocument } from 'pdf-lib';
export function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString('latin1') === '%PDF-';
}
export async function pageCount(buf: Buffer): Promise<number> {
  try { return (await PDFDocument.load(buf, { ignoreEncryption: true })).getPageCount(); }
  catch { return 0; }
}
