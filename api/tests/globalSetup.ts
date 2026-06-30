import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

// Tests run against a SEPARATE database (<db>_test) so they never delete app data.
// This setup creates that database (if missing) and applies migrations to it once
// before the suite runs. The test workers receive DATABASE_URL via vitest's test.env.

function appDbUrl(): string {
  try {
    const line = readFileSync('.env', 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
    if (line) return line.slice('DATABASE_URL='.length).trim();
  } catch { /* fall through */ }
  return 'postgresql://invoice:invoice@localhost:5432/invoice?schema=public';
}

function toTestDbUrl(url: string): string {
  const u = new URL(url);
  u.pathname = u.pathname.replace(/\/([^/?]+)$/, '/$1_test');
  return u.toString();
}

export default async function setup() {
  const testUrl = toTestDbUrl(appDbUrl());
  const dbName = new URL(testUrl).pathname.replace(/^\//, '');

  // Create the test database via the maintenance "postgres" db (ignore "already exists").
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } catch (e) {
    if (!String((e as Error).message).includes('already exists')) throw e;
  } finally {
    await admin.$disconnect();
  }

  execSync('npx prisma migrate deploy', { stdio: 'inherit', env: { ...process.env, DATABASE_URL: testUrl } });
}
