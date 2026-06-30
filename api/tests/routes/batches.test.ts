import { it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/config/db.js';

beforeEach(async () => { await prisma.invoice.deleteMany(); await prisma.batch.deleteMany(); });

it('returns per-batch status roll-ups, newest first', async () => {
  const app = await buildApp();
  const b = await prisma.batch.create({ data: { name: 'April bills' } });
  await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'ba', batchId: b.id, status: 'COMPLETED' } });
  await prisma.invoice.create({ data: { fileName: 'b.pdf', storedPath: '/b', fileHash: 'bb', batchId: b.id, status: 'FAILED' } });
  await prisma.invoice.create({ data: { fileName: 'c.pdf', storedPath: '/c', fileHash: 'bc', batchId: b.id, status: 'PROCESSING' } });

  const res = await app.inject({ url: '/api/batches' });
  const { batches } = res.json();
  expect(batches).toHaveLength(1);
  expect(batches[0]).toMatchObject({ id: b.id, name: 'April bills', total: 3, completed: 1, failed: 1, processing: 1 });
  await app.close();
});

it('returns an empty list when there are no batches', async () => {
  const app = await buildApp();
  expect((await app.inject({ url: '/api/batches' })).json().batches).toEqual([]);
  await app.close();
});
