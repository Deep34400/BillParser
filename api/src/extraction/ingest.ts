import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { sha256 } from '../lib/hash.js';
import { isPdf } from '../lib/pdf.js';
import { runExtraction } from './run.js';

export type IngestAcc = { created: any[]; duplicates: any[]; rejected: any[] };

// PDF-validate -> hash -> dedup -> store -> create invoice (tagged) -> queue extraction.
// `label` is the identifier shown in duplicates/rejected entries (source string for
// imports); when omitted it defaults to the filename (upload behavior, unchanged).
// Assumes env.uploadDir already exists (caller mkdir's it once).
export async function ingestPdf(buf: Buffer, fileName: string, batchId: string, acc: IngestAcc, label?: string): Promise<void> {
  const entryName = label ?? fileName;
  if (!isPdf(buf)) { acc.rejected.push({ fileName: entryName, reason: 'not a PDF' }); return; }
  const hash = sha256(buf);
  const existing = await prisma.invoice.findUnique({ where: { fileHash: hash } });
  if (existing) { acc.duplicates.push({ fileName: entryName, id: existing.id }); return; }
  const storedPath = join(env.uploadDir, `${hash}.pdf`);
  await writeFile(storedPath, buf);
  const inv = await prisma.invoice.create({ data: { fileName, storedPath, fileHash: hash, batchId } });
  acc.created.push(inv);
  void runExtraction(inv.id).catch((e) => console.error('[runExtraction]', e));
}

// Delete the batch when nothing was created; otherwise return the fresh batch row.
export async function finalizeBatch(batchId: string, createdCount: number) {
  if (createdCount === 0) { await prisma.batch.delete({ where: { id: batchId } }); return null; }
  return prisma.batch.findUnique({ where: { id: batchId } });
}
