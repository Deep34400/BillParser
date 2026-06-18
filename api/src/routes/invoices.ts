import type { FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { sha256 } from '../lib/hash.js';
import { isPdf } from '../lib/pdf.js';
import { runExtraction } from '../extraction/run.js';

export async function invoiceRoutes(app: FastifyInstance) {
  app.post('/api/invoices/upload', async (req, reply) => {
    await mkdir(env.uploadDir, { recursive: true });
    const created: any[] = []; const duplicates: any[] = []; const rejected: any[] = [];
    for await (const part of (req as any).parts()) {
      if (part.type !== 'file') continue;
      const buf = await part.toBuffer();
      if (!isPdf(buf)) { rejected.push({ fileName: part.filename, reason: 'not a PDF' }); continue; }
      const hash = sha256(buf);
      const existing = await prisma.invoice.findUnique({ where: { fileHash: hash } });
      if (existing) { duplicates.push({ fileName: part.filename, id: existing.id }); continue; }
      const storedPath = join(env.uploadDir, `${hash}.pdf`);
      await writeFile(storedPath, buf);
      const inv = await prisma.invoice.create({ data: { fileName: part.filename, storedPath, fileHash: hash } });
      created.push(inv);
      void runExtraction(inv.id);
    }
    reply.code(201);
    return { created, duplicates, rejected };
  });
}
