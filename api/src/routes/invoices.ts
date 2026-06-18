import type { FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { writeFile, mkdir } from 'node:fs/promises';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { sha256 } from '../lib/hash.js';
import { isPdf } from '../lib/pdf.js';
import { runExtraction } from '../extraction/run.js';

export async function invoiceRoutes(app: FastifyInstance) {
  // routes added in tasks 5.2–5.5
}
