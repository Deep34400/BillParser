import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/db.js';
beforeEach(async () => { await prisma.invoice.deleteMany(); await prisma.providerConfig.deleteMany(); });
it('bakeoff with no configured providers returns empty runs', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'h' } });
  const res = await app.inject({ method: 'POST', url: `/api/invoices/${inv.id}/bakeoff` });
  expect(res.statusCode).toBe(200);
  expect(res.json().runs).toEqual([]);
  await app.close();
});
