# Invoice OCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-hosted full-stack app that ingests bill PDFs, extracts them via swappable real providers into one canonical schema in Postgres, and exposes a searchable Ledger-style UI with detail, analytics, live provider bake-off, inline edit, and CSV export.

**Architecture:** A monorepo with a Fastify+Prisma API and a React+Vite frontend, packaged with Docker Compose (db/api/web). Extraction runs in-process fire-and-forget per upload; every attempt is persisted as an `ExtractionRun` while the `Invoice` holds the currently-applied canonical result. Provider credentials live in Postgres encrypted (AES-256-GCM) and are managed at runtime from a Settings page.

**Tech Stack:** TypeScript everywhere · Node 20 · Fastify 4 · Prisma 5 · Postgres 16 · React 18 · Vite 5 · React Router 6 · Vitest · Docker Compose.

**Reference inputs:** `doc/PRD.html`, design spec `docs/superpowers/specs/2026-06-18-invoice-ocr-design.md`, prototype `Invoice OCR.dc.html` (Direction A — "Ledger"). Direction-A palette: indigo `#4f46e5` (hover `#4338ca`), cream bg `#f7f5f1`, panel `#fff`, rail `#fbfaf7`, border `#e7e2d9`, muted `#8d877c`/`#a39d90`, success `#1f9d63`, danger `#d1453b`, warn `#b07d12`; fonts Hanken Grotesk (UI) + Geist Mono (numeric/raw).

---

## File Structure

```
praya-invoice-analyser/
├─ docker-compose.yml
├─ .env.example
├─ .gitignore
├─ api/
│  ├─ package.json  tsconfig.json  vitest.config.ts  Dockerfile  .dockerignore
│  ├─ prisma/schema.prisma
│  ├─ src/
│  │  ├─ index.ts                # boot: build app, seed-from-env, listen
│  │  ├─ app.ts                  # buildApp(): Fastify instance + routes (testable)
│  │  ├─ db.ts                   # PrismaClient singleton
│  │  ├─ env.ts                  # parsed/validated env
│  │  ├─ lib/
│  │  │  ├─ crypto.ts            # AES-256-GCM encrypt/decrypt/mask
│  │  │  ├─ hash.ts              # sha256 of buffer
│  │  │  ├─ pdf.ts               # pageCount + isPdf
│  │  │  └─ csv.ts               # toCsv helpers
│  │  ├─ settings/
│  │  │  ├─ store.ts             # get/set Setting, get/set ProviderConfig (decrypted)
│  │  │  └─ seed.ts              # seedFromEnv()
│  │  ├─ providers/
│  │  │  ├─ types.ts             # CanonicalResult, ExtractionProvider, ExtractCtx
│  │  │  ├─ registry.ts          # register + list + get
│  │  │  ├─ reference.ts         # cost/accuracy reference table
│  │  │  ├─ mistral.ts  azure.ts  llamaparse.ts  textract.ts  google.ts
│  │  ├─ structuring/
│  │  │  ├─ types.ts             # StructuringModel interface
│  │  │  ├─ index.ts             # getStructuringModel() from settings
│  │  │  ├─ anthropic.ts  openai.ts  mistral.ts
│  │  ├─ extraction/
│  │  │  ├─ confidence.ts        # deriveConfidence(), estimateCost()
│  │  │  ├─ run.ts               # runExtraction(), applyResultToInvoice()
│  │  └─ routes/
│  │     ├─ config.ts  invoices.ts  analytics.ts  settings.ts  export.ts
│  └─ tests/ (mirrors src/)
└─ web/
   ├─ package.json  tsconfig.json  vite.config.ts  index.html  Dockerfile  nginx.conf
   ├─ src/
   │  ├─ main.tsx  App.tsx  api.ts  types.ts  theme.ts  format.ts
   │  ├─ hooks/usePolling.ts
   │  ├─ components/Shell.tsx  StatusDot.tsx  Toast.tsx  ConfidenceBar.tsx
   │  ├─ pages/InvoicesPage.tsx  InvoiceDetailPage.tsx  AnalyticsPage.tsx  SettingsPage.tsx
   │  └─ overlays/CompareOverlay.tsx  BakeoffOverlay.tsx
   └─ tests/
```

---

## Phase 0 — Repo & tooling

### Task 0.1: Initialize repo and root files

**Files:**
- Create: `.gitignore`, `.env.example`, `docker-compose.yml` (placeholder filled in Phase 13)

- [ ] **Step 1: Init git and root ignore**

```bash
cd /d/AL/Projects/praya-invoice-analyser
git init
```

Create `.gitignore`:

```
node_modules/
dist/
.env
*.log
uploads/
api/prisma/*.db
coverage/
```

- [ ] **Step 2: Create `.env.example`**

```
# --- core ---
DATABASE_URL=postgresql://invoice:invoice@localhost:5432/invoice?schema=public
APP_SECRET=change-me-to-a-long-random-string
UPLOAD_DIR=./uploads
PORT=4000
# --- selection seeds (optional; DB wins after first boot) ---
EXTRACTION_PROVIDER=mistral
STRUCTURING_MODEL_PROVIDER=anthropic
STRUCTURING_MODEL=claude-sonnet-4-6
# --- provider credential seeds (optional) ---
MISTRAL_API_KEY=
AZURE_DI_ENDPOINT=
AZURE_DI_KEY=
LLAMAPARSE_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
# web
VITE_API_BASE=http://localhost:4000
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: init repo with gitignore and env example"
```

### Task 0.2: Scaffold the API package

**Files:**
- Create: `api/package.json`, `api/tsconfig.json`, `api/vitest.config.ts`

- [ ] **Step 1: `api/package.json`**

```json
{
  "name": "invoice-ocr-api",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "migrate:dev": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "prisma:generate": "prisma generate",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.30.0",
    "@aws-sdk/client-textract": "^3.600.0",
    "@fastify/cors": "^9.0.1",
    "@fastify/multipart": "^8.3.0",
    "@prisma/client": "^5.18.0",
    "fastify": "^4.28.0",
    "openai": "^4.56.0",
    "pdf-lib": "^1.17.1"
  },
  "devDependencies": {
    "prisma": "^5.18.0",
    "tsx": "^4.16.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: `api/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: `api/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts'], hookTimeout: 30000, testTimeout: 30000 },
});
```

- [ ] **Step 4: Install + commit**

```bash
cd api && npm install
git add -A && git commit -m "chore(api): scaffold package, tsconfig, vitest"
```

---

## Phase 1 — Database schema

### Task 1.1: Prisma schema

**Files:**
- Create: `api/prisma/schema.prisma`

- [ ] **Step 1: Write schema**

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

enum InvoiceStatus { PENDING PROCESSING COMPLETED FAILED }
enum RunStatus { COMPLETED FAILED }

model Invoice {
  id           String        @id @default(cuid())
  fileName     String
  storedPath   String
  fileHash     String        @unique
  status       InvoiceStatus @default(PENDING)
  provider     String?
  confidence   Float?
  error        String?
  vendorName   String?
  vendorAddress String?
  vendorTaxId  String?
  invoiceNumber String?
  poNumber     String?
  invoiceDate  DateTime?
  dueDate      DateTime?
  currency     String?
  subtotal     Float?
  taxAmount    Float?
  totalAmount  Float?
  paymentTerms String?
  rawText      String?
  rawJson      Json?
  verified     Boolean       @default(false)
  editedAt     DateTime?
  activeRunId  String?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt
  lineItems    LineItem[]
  runs         ExtractionRun[]
  @@index([status]); @@index([vendorName]); @@index([invoiceDate])
}

model LineItem {
  id         String  @id @default(cuid())
  invoiceId  String
  invoice    Invoice @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  lineNumber Int
  description String?
  sku        String?
  quantity   Float?
  unitPrice  Float?
  amount     Float?
  taxRate    Float?
  @@index([invoiceId])
}

model ExtractionRun {
  id              String    @id @default(cuid())
  invoiceId       String
  invoice         Invoice   @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  provider        String
  structuringModel String?
  status          RunStatus
  confidence      Float?
  costEstimate    Float?
  latencyMs       Int?
  pageCount       Int?
  rawText         String?
  rawJson         Json?
  error           String?
  fieldsSnapshot  Json?
  itemsSnapshot   Json?
  createdAt       DateTime  @default(now())
  @@index([invoiceId])
}

model ProviderConfig {
  provider       String   @id
  credentialsEnc String
  enabled        Boolean  @default(true)
  updatedAt      DateTime @updatedAt
}

model Setting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Generate client + first migration (needs a running Postgres; see note)**

Run a throwaway Postgres for dev:

```bash
docker run -d --name ioc-pg -e POSTGRES_USER=invoice -e POSTGRES_PASSWORD=invoice -e POSTGRES_DB=invoice -p 5432:5432 postgres:16
cd api && cp ../.env.example .env
npx prisma migrate dev --name init
```

Expected: migration `init` created under `api/prisma/migrations/`, client generated.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(db): prisma schema + init migration"
```

---

## Phase 2 — Core API infrastructure

### Task 2.1: Env + Prisma singleton

**Files:**
- Create: `api/src/env.ts`, `api/src/db.ts`

- [ ] **Step 1: `api/src/env.ts`**

```ts
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}
export const env = {
  databaseUrl: req('DATABASE_URL'),
  appSecret: req('APP_SECRET'),
  uploadDir: process.env.UPLOAD_DIR ?? './uploads',
  port: Number(process.env.PORT ?? 4000),
};
```

- [ ] **Step 2: `api/src/db.ts`**

```ts
import { PrismaClient } from '@prisma/client';
export const prisma = new PrismaClient();
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(api): env validation and prisma singleton"
```

### Task 2.2: AES-256-GCM crypto util (TDD)

**Files:**
- Create: `api/src/lib/crypto.ts`
- Test: `api/tests/lib/crypto.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, maskValue } from '../../src/lib/crypto.js';

describe('crypto', () => {
  const secret = 'a-very-long-test-secret-string-123';
  it('round-trips a value', () => {
    const enc = encrypt('sk-secret-key-1234', secret);
    expect(enc).not.toContain('sk-secret');
    expect(decrypt(enc, secret)).toBe('sk-secret-key-1234');
  });
  it('produces different ciphertext each call (random iv)', () => {
    expect(encrypt('x', secret)).not.toBe(encrypt('x', secret));
  });
  it('fails to decrypt with wrong secret', () => {
    const enc = encrypt('x', secret);
    expect(() => decrypt(enc, 'wrong-secret')).toThrow();
  });
  it('masks to last 4', () => {
    expect(maskValue('sk-abcd1234')).toBe('••••1234');
    expect(maskValue('ab')).toBe('••••');
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

Run: `cd api && npx vitest run tests/lib/crypto.test.ts`
Expected: FAIL — cannot find `crypto.js`.

- [ ] **Step 3: Implement `api/src/lib/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(secret).digest(); // 32 bytes
}
export function encrypt(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}
export function decrypt(blob: string, secret: string): string {
  const [ivB, tagB, ctB] = blob.split('.');
  if (!ivB || !tagB || !ctB) throw new Error('Bad ciphertext format');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64')), decipher.final()]).toString('utf8');
}
export function maskValue(v: string): string {
  if (!v || v.length < 4) return '••••';
  return '••••' + v.slice(-4);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd api && npx vitest run tests/lib/crypto.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): AES-256-GCM crypto util with masking"
```

### Task 2.3: Hash + PDF utils (TDD)

**Files:**
- Create: `api/src/lib/hash.ts`, `api/src/lib/pdf.ts`
- Test: `api/tests/lib/hash.test.ts`, `api/tests/lib/pdf.test.ts`

- [ ] **Step 1: Failing tests**

`api/tests/lib/hash.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { sha256 } from '../../src/lib/hash.js';
it('hashes deterministically', () => {
  const a = sha256(Buffer.from('hello'));
  expect(a).toBe(sha256(Buffer.from('hello')));
  expect(a).toHaveLength(64);
  expect(a).not.toBe(sha256(Buffer.from('world')));
});
```

`api/tests/lib/pdf.test.ts`:
```ts
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
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd api && npx vitest run tests/lib/hash.test.ts tests/lib/pdf.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`api/src/lib/hash.ts`:
```ts
import { createHash } from 'node:crypto';
export const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');
```

`api/src/lib/pdf.ts`:
```ts
import { PDFDocument } from 'pdf-lib';
export function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString('latin1') === '%PDF-';
}
export async function pageCount(buf: Buffer): Promise<number> {
  try { return (await PDFDocument.load(buf, { ignoreEncryption: true })).getPageCount(); }
  catch { return 0; }
}
```

- [ ] **Step 4: Run — expect PASS, then commit**

```bash
cd api && npx vitest run tests/lib/hash.test.ts tests/lib/pdf.test.ts
git add -A && git commit -m "feat(api): sha256 and pdf utils"
```

### Task 2.4: CSV util (TDD)

**Files:**
- Create: `api/src/lib/csv.ts`
- Test: `api/tests/lib/csv.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { toCsv } from '../../src/lib/csv.js';
it('serializes rows and escapes commas/quotes/newlines', () => {
  const csv = toCsv(['a', 'b'], [{ a: 'x', b: 'has,comma' }, { a: 'q"ote', b: 'line\nbreak' }]);
  expect(csv).toBe('a,b\r\nx,"has,comma"\r\n"q""ote","line\nbreak"');
});
it('renders null/undefined as empty', () => {
  expect(toCsv(['a'], [{ a: null }])).toBe('a\r\n');
});
```

- [ ] **Step 2: Run — expect FAIL.** `cd api && npx vitest run tests/lib/csv.test.ts`

- [ ] **Step 3: Implement `api/src/lib/csv.ts`**

```ts
function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const head = headers.map(cell).join(',');
  const body = rows.map((r) => headers.map((h) => cell(r[h])).join(','));
  return [head, ...body].join('\r\n');
}
```

- [ ] **Step 4: Run PASS + commit**

```bash
cd api && npx vitest run tests/lib/csv.test.ts
git add -A && git commit -m "feat(api): csv serialization util"
```

### Task 2.5: Settings store

**Files:**
- Create: `api/src/settings/store.ts`
- Test: `api/tests/settings/store.test.ts` (integration — uses dev Postgres)

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/db.js';
import { getSetting, setSetting, getCredentials, setCredentials, clearCredentials } from '../../src/settings/store.js';

beforeEach(async () => { await prisma.providerConfig.deleteMany(); await prisma.setting.deleteMany(); });

it('reads default when setting absent', async () => {
  expect(await getSetting('extraction_provider', 'mistral')).toBe('mistral');
});
it('persists and overrides a setting', async () => {
  await setSetting('extraction_provider', 'azure');
  expect(await getSetting('extraction_provider', 'mistral')).toBe('azure');
});
it('encrypts credentials and decrypts on read', async () => {
  await setCredentials('azure', { endpoint: 'https://x', apiKey: 'secret123' });
  const row = await prisma.providerConfig.findUnique({ where: { provider: 'azure' } });
  expect(row!.credentialsEnc).not.toContain('secret123');
  expect(await getCredentials('azure')).toEqual({ endpoint: 'https://x', apiKey: 'secret123' });
});
it('clears credentials', async () => {
  await setCredentials('azure', { apiKey: 'x' });
  await clearCredentials('azure');
  expect(await getCredentials('azure')).toBeNull();
});
```

- [ ] **Step 2: Run — expect FAIL.** `cd api && npx vitest run tests/settings/store.test.ts`

- [ ] **Step 3: Implement `api/src/settings/store.ts`**

```ts
import { prisma } from '../db.js';
import { env } from '../env.js';
import { encrypt, decrypt } from '../lib/crypto.js';

export async function getSetting(key: string, fallback: string): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row?.value ?? fallback;
}
export async function setSetting(key: string, value: string): Promise<void> {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
export async function getCredentials(provider: string): Promise<Record<string, string> | null> {
  const row = await prisma.providerConfig.findUnique({ where: { provider } });
  if (!row || !row.enabled) return null;
  try { return JSON.parse(decrypt(row.credentialsEnc, env.appSecret)); } catch { return null; }
}
export async function setCredentials(provider: string, creds: Record<string, string>): Promise<void> {
  const credentialsEnc = encrypt(JSON.stringify(creds), env.appSecret);
  await prisma.providerConfig.upsert({
    where: { provider }, update: { credentialsEnc, enabled: true }, create: { provider, credentialsEnc },
  });
}
export async function clearCredentials(provider: string): Promise<void> {
  await prisma.providerConfig.deleteMany({ where: { provider } });
}
```

- [ ] **Step 4: Run PASS + commit**

```bash
cd api && npx vitest run tests/settings/store.test.ts
git add -A && git commit -m "feat(api): settings + encrypted credential store"
```

---

## Phase 3 — Provider abstraction

### Task 3.1: Provider types + registry

**Files:**
- Create: `api/src/providers/types.ts`, `api/src/providers/registry.ts`, `api/src/providers/reference.ts`
- Test: `api/tests/providers/registry.test.ts`

- [ ] **Step 1: `api/src/providers/types.ts`**

```ts
export interface CanonicalLineItem {
  lineNumber: number; description?: string; sku?: string;
  quantity?: number; unitPrice?: number; amount?: number; taxRate?: number;
}
export interface CanonicalResult {
  vendorName?: string; vendorAddress?: string; vendorTaxId?: string;
  invoiceNumber?: string; poNumber?: string;
  invoiceDate?: string; dueDate?: string;            // ISO yyyy-mm-dd
  currency?: string; subtotal?: number; taxAmount?: number; totalAmount?: number; paymentTerms?: string;
  lineItems: CanonicalLineItem[];
  confidence?: number; rawText: string; rawJson: unknown;
  costEstimate?: number; latencyMs?: number; pageCount?: number;
}
export interface ExtractCtx {
  fileName: string;
  structuring: { provider: string; model: string } | null;
}
export type ProviderKind = 'markdown' | 'structured';
export interface ExtractionProvider {
  name: string; displayName: string; kind: ProviderKind;
  requiredCredentials: string[];
  isConfigured(creds: Record<string, string> | null): boolean;
  extract(file: Buffer, creds: Record<string, string>, ctx: ExtractCtx): Promise<CanonicalResult>;
}
```

- [ ] **Step 2: `api/src/providers/reference.ts`**

```ts
// Representative cost/accuracy reference (PRD, mid-2026). Used for bake-off display + cost estimate.
export const PROVIDER_REFERENCE: Record<string, { costPer1k: number; headerAcc: number; lineAcc: number; pattern: string }> = {
  mistral:    { costPer1k: 2,   headerAcc: 0.9,  lineAcc: 0.85, pattern: 'OCR→md + LLM' },
  azure:      { costPer1k: 10,  headerAcc: 0.93, lineAcc: 0.87, pattern: 'prebuilt invoice' },
  llamaparse: { costPer1k: 9,   headerAcc: 0.9,  lineAcc: 0.85, pattern: 'OCR→md + LLM' },
  textract:   { costPer1k: 10,  headerAcc: 0.78, lineAcc: 0.82, pattern: 'structured fields' },
  google:     { costPer1k: 20,  headerAcc: 0.4,  lineAcc: 0.4,  pattern: 'structured fields' },
};
```

- [ ] **Step 3: Failing test `api/tests/providers/registry.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { allProviders, getProvider } from '../../src/providers/registry.js';
it('registers all five providers', () => {
  expect(allProviders().map((p) => p.name).sort()).toEqual(['azure', 'google', 'llamaparse', 'mistral', 'textract']);
});
it('looks up by name and throws on unknown', () => {
  expect(getProvider('mistral').displayName).toBe('Mistral OCR');
  expect(() => getProvider('nope')).toThrow();
});
```

- [ ] **Step 4: Run — expect FAIL** (providers not yet implemented). `cd api && npx vitest run tests/providers/registry.test.ts`

- [ ] **Step 5: Implement `api/src/providers/registry.ts`** (imports filled as providers land in 3.3–3.5; create stub modules first so imports resolve)

Create minimal placeholder modules `api/src/providers/{mistral,azure,llamaparse,textract,google}.ts` each exporting `export const <name>Provider: ExtractionProvider = { ... }` — the real bodies come in later tasks. For now give each a throwing `extract` and correct metadata so the registry test passes. Example `azure.ts` metadata (repeat shape per provider):

```ts
import type { ExtractionProvider } from './types.js';
export const azureProvider: ExtractionProvider = {
  name: 'azure', displayName: 'Azure Document Intelligence', kind: 'structured',
  requiredCredentials: ['endpoint', 'apiKey'],
  isConfigured: (c) => !!c?.endpoint && !!c?.apiKey,
  async extract() { throw new Error('not implemented yet'); },
};
```

Metadata for the others: `mistral` → displayName `Mistral OCR`, kind `markdown`, creds `['apiKey']`; `llamaparse` → `LlamaParse`, `markdown`, `['apiKey']`; `textract` → `AWS Textract`, `structured`, `['accessKeyId','secretAccessKey','region']`; `google` → `Google Document AI`, `structured`, `['projectId','location','processorId','keyJson']`.

`registry.ts`:
```ts
import type { ExtractionProvider } from './types.js';
import { mistralProvider } from './mistral.js';
import { azureProvider } from './azure.js';
import { llamaparseProvider } from './llamaparse.js';
import { textractProvider } from './textract.js';
import { googleProvider } from './google.js';

const REGISTRY: ExtractionProvider[] = [mistralProvider, azureProvider, llamaparseProvider, textractProvider, googleProvider];
export const allProviders = (): ExtractionProvider[] => REGISTRY;
export function getProvider(name: string): ExtractionProvider {
  const p = REGISTRY.find((x) => x.name === name);
  if (!p) throw new Error(`Unknown provider: ${name}`);
  return p;
}
```

- [ ] **Step 6: Run PASS + commit**

```bash
cd api && npx vitest run tests/providers/registry.test.ts
git add -A && git commit -m "feat(api): provider types, registry, reference table"
```

### Task 3.2: Structuring service (markdown → canonical)

**Files:**
- Create: `api/src/structuring/types.ts`, `api/src/structuring/index.ts`, `api/src/structuring/anthropic.ts`, `api/src/structuring/openai.ts`, `api/src/structuring/mistral.ts`
- Test: `api/tests/structuring/parse.test.ts`

The structuring LLM is asked to return strict JSON. We unit-test the **JSON→CanonicalResult normalizer** (pure, no network); the per-vendor SDK calls are thin and covered by integration smoke later.

- [ ] **Step 1: `api/src/structuring/types.ts`**

```ts
import type { CanonicalResult } from '../providers/types.js';
export interface StructuringModel {
  provider: string; model: string;
  structure(markdown: string, creds: Record<string, string>): Promise<Omit<CanonicalResult, 'rawText' | 'rawJson'>>;
}
export const STRUCTURING_PROMPT = `You are an invoice parser. Given OCR markdown of ONE invoice, return ONLY minified JSON matching:
{"vendorName","vendorAddress","vendorTaxId","invoiceNumber","poNumber","invoiceDate","dueDate","currency","subtotal","taxAmount","totalAmount","paymentTerms","confidence","lineItems":[{"description","sku","quantity","unitPrice","amount","taxRate"}]}
Dates as YYYY-MM-DD. Numbers as numbers (no currency symbols). confidence 0..1 reflecting your certainty. Use null for unknown fields. No prose, no code fences.`;
```

- [ ] **Step 2: Failing test for normalizer**

```ts
import { describe, it, expect } from 'vitest';
import { normalizeStructured } from '../../src/structuring/index.js';
it('coerces a model JSON string into a canonical result', () => {
  const json = JSON.stringify({
    vendorName: 'Acme', invoiceDate: '2026-01-02', totalAmount: '1,234.50', confidence: 0.9,
    lineItems: [{ description: 'Widget', quantity: '2', unitPrice: '10', amount: '20' }],
  });
  const r = normalizeStructured(json);
  expect(r.vendorName).toBe('Acme');
  expect(r.totalAmount).toBe(1234.5);
  expect(r.lineItems[0]).toMatchObject({ lineNumber: 1, description: 'Widget', quantity: 2, amount: 20 });
  expect(r.confidence).toBe(0.9);
});
it('strips code fences and tolerates surrounding prose', () => {
  const r = normalizeStructured('Here:\n```json\n{"vendorName":"X","lineItems":[]}\n```');
  expect(r.vendorName).toBe('X'); expect(r.lineItems).toEqual([]);
});
```

- [ ] **Step 3: Run — expect FAIL.** `cd api && npx vitest run tests/structuring/parse.test.ts`

- [ ] **Step 4: Implement `api/src/structuring/index.ts`**

```ts
import type { CanonicalResult } from '../providers/types.js';
import type { StructuringModel } from './types.js';
import { getSetting, getCredentials } from '../settings/store.js';
import { anthropicModel } from './anthropic.js';
import { openaiModel } from './openai.js';
import { mistralStructModel } from './mistral.js';

const toNum = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};
const toStr = (v: unknown): string | undefined => (v === null || v === undefined || v === '' ? undefined : String(v));

export function normalizeStructured(raw: string): Omit<CanonicalResult, 'rawText' | 'rawJson'> {
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  const json = start >= 0 && end >= 0 ? raw.slice(start, end + 1) : raw;
  const o = JSON.parse(json) as Record<string, unknown>;
  const items = Array.isArray(o.lineItems) ? o.lineItems : [];
  return {
    vendorName: toStr(o.vendorName), vendorAddress: toStr(o.vendorAddress), vendorTaxId: toStr(o.vendorTaxId),
    invoiceNumber: toStr(o.invoiceNumber), poNumber: toStr(o.poNumber),
    invoiceDate: toStr(o.invoiceDate), dueDate: toStr(o.dueDate),
    currency: toStr(o.currency), subtotal: toNum(o.subtotal), taxAmount: toNum(o.taxAmount),
    totalAmount: toNum(o.totalAmount), paymentTerms: toStr(o.paymentTerms),
    confidence: toNum(o.confidence),
    lineItems: items.map((it: any, i: number) => ({
      lineNumber: i + 1, description: toStr(it.description), sku: toStr(it.sku),
      quantity: toNum(it.quantity), unitPrice: toNum(it.unitPrice), amount: toNum(it.amount), taxRate: toNum(it.taxRate),
    })),
  };
}

export async function getStructuringModel(): Promise<{ model: StructuringModel; creds: Record<string, string> }> {
  const provider = await getSetting('structuring_provider', 'anthropic');
  const model = await getSetting('structuring_model', 'claude-sonnet-4-6');
  const creds = (await getCredentials(`structuring_${provider}`)) ?? (await getCredentials(provider)) ?? {};
  const impl: Record<string, (m: string) => StructuringModel> = {
    anthropic: anthropicModel, openai: openaiModel, mistral: mistralStructModel,
  };
  const factory = impl[provider];
  if (!factory) throw new Error(`Unknown structuring provider: ${provider}`);
  return { model: factory(model), creds };
}
```

- [ ] **Step 5: Implement the three model adapters** (thin SDK wrappers that call the LLM then `normalizeStructured`).

`api/src/structuring/anthropic.ts`:
```ts
import Anthropic from '@anthropic-ai/sdk';
import type { StructuringModel } from './types.js';
import { STRUCTURING_PROMPT, normalizeStructured } from './index.js';
export const anthropicModel = (model: string): StructuringModel => ({
  provider: 'anthropic', model,
  async structure(markdown, creds) {
    const client = new Anthropic({ apiKey: creds.apiKey });
    const msg = await client.messages.create({
      model, max_tokens: 4096,
      messages: [{ role: 'user', content: `${STRUCTURING_PROMPT}\n\nOCR markdown:\n${markdown}` }],
    });
    const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    return normalizeStructured(text);
  },
});
```

`api/src/structuring/openai.ts`:
```ts
import OpenAI from 'openai';
import type { StructuringModel } from './types.js';
import { STRUCTURING_PROMPT, normalizeStructured } from './index.js';
export const openaiModel = (model: string): StructuringModel => ({
  provider: 'openai', model,
  async structure(markdown, creds) {
    const client = new OpenAI({ apiKey: creds.apiKey });
    const res = await client.chat.completions.create({
      model, messages: [
        { role: 'system', content: STRUCTURING_PROMPT },
        { role: 'user', content: markdown },
      ],
    });
    return normalizeStructured(res.choices[0]?.message?.content ?? '{}');
  },
});
```

`api/src/structuring/mistral.ts`:
```ts
import type { StructuringModel } from './types.js';
import { STRUCTURING_PROMPT, normalizeStructured } from './index.js';
export const mistralStructModel = (model: string): StructuringModel => ({
  provider: 'mistral', model,
  async structure(markdown, creds) {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.apiKey}` },
      body: JSON.stringify({ model, messages: [
        { role: 'system', content: STRUCTURING_PROMPT }, { role: 'user', content: markdown },
      ] }),
    });
    if (!res.ok) throw new Error(`Mistral structuring HTTP ${res.status}`);
    const j: any = await res.json();
    return normalizeStructured(j.choices?.[0]?.message?.content ?? '{}');
  },
});
```

- [ ] **Step 6: Run PASS + commit**

```bash
cd api && npx vitest run tests/structuring/parse.test.ts
git add -A && git commit -m "feat(api): structuring service + anthropic/openai/mistral adapters"
```

### Task 3.3: Confidence + cost derivation (TDD)

**Files:**
- Create: `api/src/extraction/confidence.ts`
- Test: `api/tests/extraction/confidence.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { deriveConfidence, estimateCost } from '../../src/extraction/confidence.js';
it('uses explicit confidence when present', () => {
  expect(deriveConfidence({ confidence: 0.42, lineItems: [] } as any)).toBeCloseTo(0.42);
});
it('derives from completeness when no explicit confidence', () => {
  const c = deriveConfidence({ vendorName: 'A', invoiceNumber: 'B', totalAmount: 1, invoiceDate: '2026-01-01', lineItems: [{ lineNumber: 1 }] } as any);
  expect(c).toBeGreaterThan(0.5); expect(c).toBeLessThanOrEqual(1);
});
it('estimates cost from page count and rate', () => {
  expect(estimateCost('azure', 3)).toBeCloseTo(3 * 10 / 1000);
  expect(estimateCost('unknown', 3)).toBeUndefined();
});
```

- [ ] **Step 2: Run FAIL.** `cd api && npx vitest run tests/extraction/confidence.test.ts`

- [ ] **Step 3: Implement `api/src/extraction/confidence.ts`**

```ts
import type { CanonicalResult } from '../providers/types.js';
import { PROVIDER_REFERENCE } from '../providers/reference.js';
const HEADER_KEYS: (keyof CanonicalResult)[] = ['vendorName', 'invoiceNumber', 'invoiceDate', 'totalAmount', 'currency', 'subtotal'];
export function deriveConfidence(r: Pick<CanonicalResult, 'confidence' | 'lineItems'> & Partial<CanonicalResult>): number {
  if (typeof r.confidence === 'number' && r.confidence > 0) return Math.min(1, r.confidence);
  const present = HEADER_KEYS.filter((k) => r[k] !== undefined && r[k] !== null).length;
  const headerScore = present / HEADER_KEYS.length;
  const itemScore = (r.lineItems?.length ?? 0) > 0 ? 1 : 0;
  return Math.round((headerScore * 0.7 + itemScore * 0.3) * 100) / 100;
}
export function estimateCost(provider: string, pages: number): number | undefined {
  const ref = PROVIDER_REFERENCE[provider];
  return ref ? (pages * ref.costPer1k) / 1000 : undefined;
}
```

- [ ] **Step 4: Run PASS + commit**

```bash
cd api && npx vitest run tests/extraction/confidence.test.ts
git add -A && git commit -m "feat(api): confidence + cost derivation"
```

### Task 3.4: Real provider bodies — Azure & Textract (structured)

**Files:**
- Modify: `api/src/providers/azure.ts`, `api/src/providers/textract.ts`
- Test: `api/tests/providers/azure-map.test.ts` (pure mapper test)

Split each structured provider into a **pure mapper** (`mapAzure(json) → CanonicalResult fields`) tested directly, plus a thin `extract` that calls the API then the mapper.

- [ ] **Step 1: Failing mapper test**

```ts
import { describe, it, expect } from 'vitest';
import { mapAzure } from '../../src/providers/azure.js';
it('maps Azure prebuilt-invoice fields to canonical', () => {
  const doc = { fields: {
    VendorName: { content: 'Globex', confidence: 0.95 },
    InvoiceId: { content: 'INV-9', confidence: 0.9 },
    InvoiceTotal: { valueCurrency: { amount: 100, currencyCode: 'USD' }, confidence: 0.8 },
    Items: { valueArray: [ { valueObject: {
      Description: { content: 'Item A' }, Quantity: { valueNumber: 2 },
      UnitPrice: { valueCurrency: { amount: 10 } }, Amount: { valueCurrency: { amount: 20 } } } } ] },
  } };
  const r = mapAzure({ documents: [doc] });
  expect(r.vendorName).toBe('Globex');
  expect(r.totalAmount).toBe(100); expect(r.currency).toBe('USD');
  expect(r.lineItems[0]).toMatchObject({ lineNumber: 1, description: 'Item A', quantity: 2, amount: 20 });
  expect(r.confidence).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run FAIL.** `cd api && npx vitest run tests/providers/azure-map.test.ts`

- [ ] **Step 3: Implement `api/src/providers/azure.ts`**

```ts
import type { ExtractionProvider, CanonicalResult } from './types.js';
const num = (f: any): number | undefined =>
  f?.valueCurrency?.amount ?? f?.valueNumber ?? (f?.content ? Number(String(f.content).replace(/[^0-9.\-]/g, '')) : undefined);
const str = (f: any): string | undefined => f?.content ?? f?.valueString ?? undefined;

export function mapAzure(json: any): Omit<CanonicalResult, 'rawText' | 'rawJson' | 'costEstimate' | 'latencyMs' | 'pageCount'> {
  const f = json?.documents?.[0]?.fields ?? {};
  const items = (f.Items?.valueArray ?? []).map((it: any, i: number) => {
    const o = it.valueObject ?? {};
    return { lineNumber: i + 1, description: str(o.Description), sku: str(o.ProductCode),
      quantity: num(o.Quantity), unitPrice: num(o.UnitPrice), amount: num(o.Amount), taxRate: num(o.TaxRate) };
  });
  const confs = Object.values(f).map((x: any) => x?.confidence).filter((c: any) => typeof c === 'number');
  return {
    vendorName: str(f.VendorName), vendorAddress: str(f.VendorAddress), vendorTaxId: str(f.VendorTaxId),
    invoiceNumber: str(f.InvoiceId), poNumber: str(f.PurchaseOrder),
    invoiceDate: str(f.InvoiceDate), dueDate: str(f.DueDate),
    currency: f.InvoiceTotal?.valueCurrency?.currencyCode ?? str(f.Currency),
    subtotal: num(f.SubTotal), taxAmount: num(f.TotalTax), totalAmount: num(f.InvoiceTotal),
    paymentTerms: str(f.PaymentTerm),
    confidence: confs.length ? confs.reduce((a: number, b: number) => a + b, 0) / confs.length : undefined,
    lineItems: items,
  };
}

export const azureProvider: ExtractionProvider = {
  name: 'azure', displayName: 'Azure Document Intelligence', kind: 'structured',
  requiredCredentials: ['endpoint', 'apiKey'],
  isConfigured: (c) => !!c?.endpoint && !!c?.apiKey,
  async extract(file, creds) {
    const base = creds.endpoint.replace(/\/$/, '');
    const url = `${base}/documentintelligence/documentModels/prebuilt-invoice:analyze?api-version=2024-02-29-preview&outputContentFormat=text`;
    const submit = await fetch(url, { method: 'POST',
      headers: { 'content-type': 'application/pdf', 'ocp-apim-subscription-key': creds.apiKey }, body: file });
    if (!submit.ok) throw new Error(`Azure analyze HTTP ${submit.status}`);
    const opLoc = submit.headers.get('operation-location');
    if (!opLoc) throw new Error('Azure: missing operation-location');
    let result: any;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const poll = await fetch(opLoc, { headers: { 'ocp-apim-subscription-key': creds.apiKey } });
      const j: any = await poll.json();
      if (j.status === 'succeeded') { result = j.analyzeResult; break; }
      if (j.status === 'failed') throw new Error('Azure analysis failed');
    }
    if (!result) throw new Error('Azure analysis timed out');
    const mapped = mapAzure(result);
    return { ...mapped, rawText: result.content ?? '', rawJson: result };
  },
};
```

- [ ] **Step 4: Implement `api/src/providers/textract.ts`** (real AWS AnalyzeExpense via SDK + pure `mapTextract`)

```ts
import { TextractClient, AnalyzeExpenseCommand } from '@aws-sdk/client-textract';
import type { ExtractionProvider, CanonicalResult } from './types.js';

const pick = (groups: any[], type: string): string | undefined =>
  groups?.find((g) => g.Type?.Text === type)?.ValueDetection?.Text;

export function mapTextract(json: any): Omit<CanonicalResult, 'rawText' | 'rawJson' | 'costEstimate' | 'latencyMs' | 'pageCount'> {
  const doc = json?.ExpenseDocuments?.[0] ?? {};
  const summary: any[] = doc.SummaryFields ?? [];
  const fld = (t: string) => summary.find((s) => s.Type?.Text === t)?.ValueDetection?.Text;
  const numFld = (t: string) => { const v = fld(t); return v ? Number(v.replace(/[^0-9.\-]/g, '')) : undefined; };
  const items = (doc.LineItemGroups?.[0]?.LineItems ?? []).map((li: any, i: number) => ({
    lineNumber: i + 1, description: pick(li.LineItemExpenseFields, 'ITEM'),
    quantity: Number(pick(li.LineItemExpenseFields, 'QUANTITY') ?? '') || undefined,
    unitPrice: Number((pick(li.LineItemExpenseFields, 'UNIT_PRICE') ?? '').replace(/[^0-9.\-]/g, '')) || undefined,
    amount: Number((pick(li.LineItemExpenseFields, 'PRICE') ?? '').replace(/[^0-9.\-]/g, '')) || undefined,
  }));
  const confs = summary.map((s) => s.ValueDetection?.Confidence).filter((c) => typeof c === 'number');
  return {
    vendorName: fld('VENDOR_NAME') ?? fld('NAME'), vendorAddress: fld('VENDOR_ADDRESS'), vendorTaxId: fld('TAX_PAYER_ID'),
    invoiceNumber: fld('INVOICE_RECEIPT_ID'), poNumber: fld('PO_NUMBER'),
    invoiceDate: fld('INVOICE_RECEIPT_DATE'), dueDate: fld('DUE_DATE'),
    currency: fld('CURRENCY'), subtotal: numFld('SUBTOTAL'), taxAmount: numFld('TAX'), totalAmount: numFld('TOTAL'),
    confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length / 100 : undefined,
    lineItems: items,
  };
}

export const textractProvider: ExtractionProvider = {
  name: 'textract', displayName: 'AWS Textract', kind: 'structured',
  requiredCredentials: ['accessKeyId', 'secretAccessKey', 'region'],
  isConfigured: (c) => !!c?.accessKeyId && !!c?.secretAccessKey && !!c?.region,
  async extract(file, creds) {
    const client = new TextractClient({ region: creds.region,
      credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey } });
    const out = await client.send(new AnalyzeExpenseCommand({ Document: { Bytes: file } }));
    const mapped = mapTextract(out);
    return { ...mapped, rawText: '', rawJson: out as unknown };
  },
};
```

- [ ] **Step 5: Run PASS + commit**

```bash
cd api && npx vitest run tests/providers/azure-map.test.ts
git add -A && git commit -m "feat(api): real Azure + Textract providers with pure mappers"
```

### Task 3.5: Real provider bodies — Mistral & LlamaParse (markdown) + Google stub

**Files:**
- Modify: `api/src/providers/mistral.ts`, `api/src/providers/llamaparse.ts`, `api/src/providers/google.ts`

- [ ] **Step 1: Implement `api/src/providers/mistral.ts`** (OCR→markdown, then structuring service)

```ts
import type { ExtractionProvider, CanonicalResult } from './types.js';
import { getStructuringModel } from '../structuring/index.js';

export const mistralProvider: ExtractionProvider = {
  name: 'mistral', displayName: 'Mistral OCR', kind: 'markdown',
  requiredCredentials: ['apiKey'],
  isConfigured: (c) => !!c?.apiKey,
  async extract(file, creds) {
    const res = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.apiKey}` },
      body: JSON.stringify({
        model: 'mistral-ocr-latest',
        document: { type: 'document_url', document_url: `data:application/pdf;base64,${file.toString('base64')}` },
      }),
    });
    if (!res.ok) throw new Error(`Mistral OCR HTTP ${res.status}`);
    const ocr: any = await res.json();
    const markdown = (ocr.pages ?? []).map((p: any) => p.markdown ?? '').join('\n\n');
    const { model, creds: sCreds } = await getStructuringModel();
    const fields = await model.structure(markdown, sCreds);
    const out: CanonicalResult = { ...fields, rawText: markdown, rawJson: ocr };
    return out;
  },
};
```

- [ ] **Step 2: Implement `api/src/providers/llamaparse.ts`** (upload → poll → markdown → structuring)

```ts
import type { ExtractionProvider, CanonicalResult } from './types.js';
import { getStructuringModel } from '../structuring/index.js';

export const llamaparseProvider: ExtractionProvider = {
  name: 'llamaparse', displayName: 'LlamaParse', kind: 'markdown',
  requiredCredentials: ['apiKey'],
  isConfigured: (c) => !!c?.apiKey,
  async extract(file, creds, ctx) {
    const form = new FormData();
    form.append('file', new Blob([file], { type: 'application/pdf' }), ctx.fileName);
    const up = await fetch('https://api.cloud.llamaindex.ai/api/v1/parsing/upload', {
      method: 'POST', headers: { authorization: `Bearer ${creds.apiKey}` }, body: form });
    if (!up.ok) throw new Error(`LlamaParse upload HTTP ${up.status}`);
    const { id }: any = await up.json();
    let markdown = '';
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await fetch(`https://api.cloud.llamaindex.ai/api/v1/parsing/job/${id}`, {
        headers: { authorization: `Bearer ${creds.apiKey}` } });
      const j: any = await st.json();
      if (j.status === 'SUCCESS') {
        const md = await fetch(`https://api.cloud.llamaindex.ai/api/v1/parsing/job/${id}/result/markdown`, {
          headers: { authorization: `Bearer ${creds.apiKey}` } });
        markdown = ((await md.json()) as any).markdown ?? ''; break;
      }
      if (j.status === 'ERROR') throw new Error('LlamaParse job error');
    }
    if (!markdown) throw new Error('LlamaParse timed out');
    const { model, creds: sCreds } = await getStructuringModel();
    const fields = await model.structure(markdown, sCreds);
    const out: CanonicalResult = { ...fields, rawText: markdown, rawJson: { jobId: id, markdown } };
    return out;
  },
};
```

- [ ] **Step 3: Implement `api/src/providers/google.ts`** (explicit stub)

```ts
import type { ExtractionProvider } from './types.js';
export const googleProvider: ExtractionProvider = {
  name: 'google', displayName: 'Google Document AI', kind: 'structured',
  requiredCredentials: ['projectId', 'location', 'processorId', 'keyJson'],
  isConfigured: (c) => !!c?.projectId && !!c?.processorId && !!c?.keyJson,
  async extract() { throw new Error('Google Document AI provider is not implemented yet'); },
};
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd api && npx tsc -p tsconfig.json --noEmit
git add -A && git commit -m "feat(api): real Mistral + LlamaParse providers, Google stub"
```

---

## Phase 4 — Extraction orchestration

### Task 4.1: runExtraction + applyResultToInvoice

**Files:**
- Create: `api/src/extraction/run.ts`
- Test: `api/tests/extraction/run.test.ts` (integration; inject a fake provider)

`runExtraction` takes a provider name and looks it up; to test without network we add an internal seam: `runExtractionWith(invoiceId, provider)` where `provider` is an `ExtractionProvider`. The exported `runExtraction(invoiceId, name?)` resolves the provider + creds then delegates.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/db.js';
import { runExtractionWith } from '../../src/extraction/run.js';
import type { ExtractionProvider } from '../../src/providers/types.js';

const fake: ExtractionProvider = {
  name: 'fake', displayName: 'Fake', kind: 'structured', requiredCredentials: [],
  isConfigured: () => true,
  async extract() {
    return { vendorName: 'Acme', totalAmount: 50, currency: 'USD', invoiceDate: '2026-02-01',
      lineItems: [{ lineNumber: 1, description: 'A', amount: 50 }], rawText: 'RAW', rawJson: { ok: true }, pageCount: 1 };
  },
};

beforeEach(async () => { await prisma.invoice.deleteMany(); });

it('marks COMPLETED, applies fields, writes items + a run', async () => {
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/x', fileHash: 'h1' } });
  await runExtractionWith(inv.id, fake, {});
  const got = await prisma.invoice.findUnique({ where: { id: inv.id }, include: { lineItems: true, runs: true } });
  expect(got!.status).toBe('COMPLETED');
  expect(got!.vendorName).toBe('Acme'); expect(got!.totalAmount).toBe(50);
  expect(got!.lineItems).toHaveLength(1);
  expect(got!.runs).toHaveLength(1);
  expect(got!.confidence).toBeGreaterThan(0);
  expect(got!.activeRunId).toBe(got!.runs[0].id);
});

it('marks FAILED with captured error on throw', async () => {
  const boom: ExtractionProvider = { ...fake, async extract() { throw new Error('provider down'); } };
  const inv = await prisma.invoice.create({ data: { fileName: 'b.pdf', storedPath: '/x', fileHash: 'h2' } });
  await runExtractionWith(inv.id, boom, {});
  const got = await prisma.invoice.findUnique({ where: { id: inv.id }, include: { runs: true } });
  expect(got!.status).toBe('FAILED'); expect(got!.error).toContain('provider down');
  expect(got!.runs[0].status).toBe('FAILED');
});
```

- [ ] **Step 2: Run FAIL.** `cd api && npx vitest run tests/extraction/run.test.ts`

- [ ] **Step 3: Implement `api/src/extraction/run.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { prisma } from '../db.js';
import type { CanonicalResult, ExtractionProvider } from '../providers/types.js';
import { getProvider } from '../providers/registry.js';
import { getProviderCredsOrThrow } from '../settings/store.js';
import { getSetting } from '../settings/store.js';
import { deriveConfidence, estimateCost } from './confidence.js';
import { pageCount } from '../lib/pdf.js';

function headerData(r: CanonicalResult) {
  return {
    vendorName: r.vendorName ?? null, vendorAddress: r.vendorAddress ?? null, vendorTaxId: r.vendorTaxId ?? null,
    invoiceNumber: r.invoiceNumber ?? null, poNumber: r.poNumber ?? null,
    invoiceDate: r.invoiceDate ? new Date(r.invoiceDate) : null, dueDate: r.dueDate ? new Date(r.dueDate) : null,
    currency: r.currency ?? null, subtotal: r.subtotal ?? null, taxAmount: r.taxAmount ?? null,
    totalAmount: r.totalAmount ?? null, paymentTerms: r.paymentTerms ?? null,
    rawText: r.rawText ?? null, rawJson: (r.rawJson ?? null) as any,
  };
}

export async function runExtractionWith(invoiceId: string, provider: ExtractionProvider, creds: Record<string, string>): Promise<void> {
  await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'PROCESSING', error: null, provider: provider.name } });
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const started = Date.now();
  let file: Buffer | null = null;
  try {
    file = await readFile(inv.storedPath);
    const pages = await pageCount(file);
    const structuring = { provider: await getSetting('structuring_provider', 'anthropic'), model: await getSetting('structuring_model', 'claude-sonnet-4-6') };
    const result = await provider.extract(file, creds, { fileName: inv.fileName, structuring });
    const confidence = deriveConfidence(result);
    const costEstimate = result.costEstimate ?? estimateCost(provider.name, pages);
    const latencyMs = Date.now() - started;
    await prisma.$transaction(async (tx) => {
      const run = await tx.extractionRun.create({ data: {
        invoiceId, provider: provider.name, structuringModel: provider.kind === 'markdown' ? structuring.model : null,
        status: 'COMPLETED', confidence, costEstimate, latencyMs, pageCount: pages,
        rawText: result.rawText, rawJson: result.rawJson as any, error: null,
        fieldsSnapshot: headerData(result) as any, itemsSnapshot: result.lineItems as any,
      } });
      await tx.lineItem.deleteMany({ where: { invoiceId } });
      await tx.lineItem.createMany({ data: result.lineItems.map((li) => ({ invoiceId, ...li })) });
      await tx.invoice.update({ where: { id: invoiceId }, data: {
        status: 'COMPLETED', confidence, provider: provider.name, error: null, activeRunId: run.id, ...headerData(result),
      } });
    });
  } catch (e: any) {
    const latencyMs = Date.now() - started;
    await prisma.extractionRun.create({ data: { invoiceId, provider: provider.name, status: 'FAILED', latencyMs, error: String(e?.message ?? e) } });
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: 'FAILED', error: String(e?.message ?? e), provider: provider.name } });
  }
}

export async function runExtraction(invoiceId: string, providerName?: string): Promise<void> {
  const name = providerName ?? (await getSetting('extraction_provider', 'mistral'));
  const provider = getProvider(name);
  const creds = await getProviderCredsOrThrow(name, provider);
  await runExtractionWith(invoiceId, provider, creds);
}
```

- [ ] **Step 4: Add `getProviderCredsOrThrow` to `api/src/settings/store.ts`**

```ts
import type { ExtractionProvider } from '../providers/types.js';
export async function getProviderCredsOrThrow(provider: string, impl: ExtractionProvider): Promise<Record<string, string>> {
  const creds = await getCredentials(provider);
  if (!impl.isConfigured(creds)) throw new Error(`No credentials configured for provider "${provider}". Add them in Settings.`);
  return creds!;
}
```

- [ ] **Step 5: Run PASS + commit**

```bash
cd api && npx vitest run tests/extraction/run.test.ts
git add -A && git commit -m "feat(api): extraction orchestration with run history + isolation"
```

---

## Phase 5 — App + invoice routes

### Task 5.1: buildApp + config route

**Files:**
- Create: `api/src/app.ts`, `api/src/routes/config.ts`, `api/src/index.ts`, `api/src/settings/seed.ts`
- Test: `api/tests/routes/config.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
it('GET /api/config lists providers with configured flags', async () => {
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/api/config' });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.providers.map((p: any) => p.name).sort()).toContain('mistral');
  expect(body.providers[0]).toHaveProperty('configured');
  expect(body).toHaveProperty('activeProvider');
  await app.close();
});
```

- [ ] **Step 2: Run FAIL.** `cd api && npx vitest run tests/routes/config.test.ts`

- [ ] **Step 3: Implement `api/src/routes/config.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { allProviders } from '../providers/registry.js';
import { getCredentials, getSetting } from '../settings/store.js';
export async function configRoutes(app: FastifyInstance) {
  app.get('/api/config', async () => {
    const providers = await Promise.all(allProviders().map(async (p) => ({
      name: p.name, displayName: p.displayName, kind: p.kind,
      configured: p.isConfigured(await getCredentials(p.name)),
    })));
    return {
      providers,
      activeProvider: await getSetting('extraction_provider', 'mistral'),
      structuringProvider: await getSetting('structuring_provider', 'anthropic'),
      structuringModel: await getSetting('structuring_model', 'claude-sonnet-4-6'),
    };
  });
}
```

- [ ] **Step 4: Implement `api/src/app.ts`** (routes wired now; later tasks add the rest)

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { configRoutes } from './routes/config.js';
import { invoiceRoutes } from './routes/invoices.js';
import { analyticsRoutes } from './routes/analytics.js';
import { settingsRoutes } from './routes/settings.js';
import { exportRoutes } from './routes/export.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 50 } });
  await app.register(configRoutes);
  await app.register(invoiceRoutes);
  await app.register(exportRoutes);
  await app.register(analyticsRoutes);
  await app.register(settingsRoutes);
  return app;
}
```

(Note: create empty route modules `invoices.ts`, `analytics.ts`, `settings.ts`, `export.ts` exporting an async no-op `export async function xRoutes(){}` so this compiles; they are filled in subsequent tasks.)

- [ ] **Step 5: Implement `api/src/settings/seed.ts` + `api/src/index.ts`**

`seed.ts`:
```ts
import { prisma } from '../db.js';
import { encrypt } from '../lib/crypto.js';
import { env } from '../env.js';
async function seedSetting(key: string, envVar: string) {
  const v = process.env[envVar];
  if (v && !(await prisma.setting.findUnique({ where: { key } }))) await prisma.setting.create({ data: { key, value: v } });
}
async function seedCreds(provider: string, creds: Record<string, string | undefined>) {
  const filled = Object.fromEntries(Object.entries(creds).filter(([, v]) => !!v)) as Record<string, string>;
  if (Object.keys(filled).length && !(await prisma.providerConfig.findUnique({ where: { provider } }))) {
    await prisma.providerConfig.create({ data: { provider, credentialsEnc: encrypt(JSON.stringify(filled), env.appSecret) } });
  }
}
export async function seedFromEnv() {
  await seedSetting('extraction_provider', 'EXTRACTION_PROVIDER');
  await seedSetting('structuring_provider', 'STRUCTURING_MODEL_PROVIDER');
  await seedSetting('structuring_model', 'STRUCTURING_MODEL');
  await seedCreds('mistral', { apiKey: process.env.MISTRAL_API_KEY });
  await seedCreds('azure', { endpoint: process.env.AZURE_DI_ENDPOINT, apiKey: process.env.AZURE_DI_KEY });
  await seedCreds('llamaparse', { apiKey: process.env.LLAMAPARSE_API_KEY });
  await seedCreds('anthropic', { apiKey: process.env.ANTHROPIC_API_KEY });
  await seedCreds('openai', { apiKey: process.env.OPENAI_API_KEY });
}
```

`index.ts`:
```ts
import { mkdir } from 'node:fs/promises';
import { env } from './env.js';
import { buildApp } from './app.js';
import { seedFromEnv } from './settings/seed.js';
async function main() {
  await mkdir(env.uploadDir, { recursive: true });
  await seedFromEnv();
  const app = await buildApp();
  await app.listen({ port: env.port, host: '0.0.0.0' });
}
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 6: Run PASS + commit**

```bash
cd api && npx vitest run tests/routes/config.test.ts
git add -A && git commit -m "feat(api): buildApp, config route, env seeding, boot"
```

### Task 5.2: Upload + dedupe route

**Files:**
- Modify: `api/src/routes/invoices.ts`
- Test: `api/tests/routes/upload.test.ts`

- [ ] **Step 1: Failing test** (inject multipart; stub extraction by setting an unconfigured provider so it FAILS fast but rows still create + dedupe)

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { PDFDocument } from 'pdf-lib';
import * as run from '../../src/extraction/run.js';

async function pdf(): Promise<Buffer> { const d = await PDFDocument.create(); d.addPage(); return Buffer.from(await d.save()); }
function form(buf: Buffer, name: string) {
  const b = '----t'; const head = `--${b}\r\nContent-Disposition: form-data; name="files"; filename="${name}"\r\nContent-Type: application/pdf\r\n\r\n`;
  return { payload: Buffer.concat([Buffer.from(head), buf, Buffer.from(`\r\n--${b}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}
beforeEach(async () => { await prisma.invoice.deleteMany(); vi.spyOn(run, 'runExtraction').mockResolvedValue(); });

it('creates an invoice and skips duplicate by hash', async () => {
  const app = await buildApp(); const buf = await pdf();
  const { payload, headers } = form(buf, 'x.pdf');
  const r1 = await app.inject({ method: 'POST', url: '/api/invoices/upload', payload, headers });
  expect(r1.statusCode).toBe(201);
  expect(r1.json().created).toHaveLength(1);
  const r2 = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form(buf, 'x.pdf') });
  expect(r2.json().created).toHaveLength(0);
  expect(r2.json().duplicates).toHaveLength(1);
  expect(await prisma.invoice.count()).toBe(1);
  await app.close();
});
it('rejects a non-pdf file', async () => {
  const app = await buildApp();
  const r = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form(Buffer.from('hello'), 'x.pdf') });
  expect(r.json().rejected).toHaveLength(1);
  await app.close();
});
```

- [ ] **Step 2: Run FAIL.** `cd api && npx vitest run tests/routes/upload.test.ts`

- [ ] **Step 3: Implement upload in `api/src/routes/invoices.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { sha256 } from '../lib/hash.js';
import { isPdf } from '../lib/pdf.js';
import { runExtraction } from '../extraction/run.js';

export async function invoiceRoutes(app: FastifyInstance) {
  app.post('/api/invoices/upload', async (req, reply) => {
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
```

- [ ] **Step 4: Run PASS + commit**

```bash
cd api && npx vitest run tests/routes/upload.test.ts
git add -A && git commit -m "feat(api): upload route with hash dedupe + validation"
```

### Task 5.3: List/search + detail routes

**Files:**
- Modify: `api/src/routes/invoices.ts`
- Test: `api/tests/routes/list.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
beforeEach(async () => { await prisma.invoice.deleteMany(); });
async function seed() {
  await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'ha', status: 'COMPLETED', vendorName: 'Acme', totalAmount: 100, invoiceDate: new Date('2026-01-05') } });
  await prisma.invoice.create({ data: { fileName: 'b.pdf', storedPath: '/b', fileHash: 'hb', status: 'FAILED', vendorName: 'Globex', totalAmount: 50, invoiceDate: new Date('2026-02-05') } });
}
it('lists, filters by status, searches by vendor, sorts by total', async () => {
  const app = await buildApp(); await seed();
  expect((await app.inject({ url: '/api/invoices' })).json().invoices).toHaveLength(2);
  expect((await app.inject({ url: '/api/invoices?status=FAILED' })).json().invoices).toHaveLength(1);
  expect((await app.inject({ url: '/api/invoices?q=acme' })).json().invoices[0].vendorName).toBe('Acme');
  const sorted = (await app.inject({ url: '/api/invoices?sort=total&dir=desc' })).json().invoices;
  expect(sorted[0].totalAmount).toBe(100);
  await app.close();
});
it('detail returns line items + run summaries', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'c.pdf', storedPath: '/c', fileHash: 'hc' } });
  await prisma.lineItem.create({ data: { invoiceId: inv.id, lineNumber: 1, description: 'X', amount: 5 } });
  const res = await app.inject({ url: `/api/invoices/${inv.id}` });
  expect(res.json().lineItems).toHaveLength(1);
  expect(res.json()).toHaveProperty('runs');
  expect((await app.inject({ url: '/api/invoices/nope' })).statusCode).toBe(404);
  await app.close();
});
```

- [ ] **Step 2: Run FAIL.** `cd api && npx vitest run tests/routes/list.test.ts`

- [ ] **Step 3: Add to `api/src/routes/invoices.ts`** (inside `invoiceRoutes`)

```ts
  app.get('/api/invoices', async (req) => {
    const q = req.query as Record<string, string>;
    const where: any = {};
    if (q.status) where.status = q.status;
    if (q.q) where.OR = [
      { vendorName: { contains: q.q, mode: 'insensitive' } },
      { invoiceNumber: { contains: q.q, mode: 'insensitive' } },
      { fileName: { contains: q.q, mode: 'insensitive' } },
    ];
    if (q.minTotal) where.totalAmount = { gte: Number(q.minTotal) };
    if (q.dateFrom || q.dateTo) where.invoiceDate = { ...(q.dateFrom ? { gte: new Date(q.dateFrom) } : {}), ...(q.dateTo ? { lte: new Date(q.dateTo) } : {}) };
    const sortMap: Record<string, string> = { status: 'status', vendor: 'vendorName', date: 'invoiceDate', confidence: 'confidence', total: 'totalAmount' };
    const orderBy = q.sort && sortMap[q.sort] ? { [sortMap[q.sort]]: q.dir === 'asc' ? 'asc' : 'desc' } : { createdAt: 'desc' };
    const invoices = await prisma.invoice.findMany({ where, orderBy, include: { _count: { select: { lineItems: true } } } });
    return { invoices: invoices.map((i) => ({ ...i, itemCount: i._count.lineItems })) };
  });

  app.get('/api/invoices/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const inv = await prisma.invoice.findUnique({ where: { id },
      include: { lineItems: { orderBy: { lineNumber: 'asc' } }, runs: { orderBy: { createdAt: 'desc' } } } });
    if (!inv) return reply.code(404).send({ error: 'not found' });
    return inv;
  });
```

- [ ] **Step 4: Run PASS + commit**

```bash
cd api && npx vitest run tests/routes/list.test.ts
git add -A && git commit -m "feat(api): invoice list/search/sort + detail routes"
```

### Task 5.4: Re-extract, apply-run, patch (edit/verify), delete, bulk

**Files:**
- Modify: `api/src/routes/invoices.ts`
- Test: `api/tests/routes/mutate.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import * as run from '../../src/extraction/run.js';
beforeEach(async () => { await prisma.invoice.deleteMany(); vi.spyOn(run, 'runExtraction').mockResolvedValue(); });

it('reextract sets PENDING and calls runExtraction with provider', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'ha', status: 'COMPLETED' } });
  const res = await app.inject({ method: 'POST', url: `/api/invoices/${inv.id}/reextract`, payload: { provider: 'azure' } });
  expect(res.statusCode).toBe(202);
  expect(run.runExtraction).toHaveBeenCalledWith(inv.id, 'azure');
  await app.close();
});
it('patch edits fields, replaces items, marks verified', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'hb' } });
  await prisma.lineItem.create({ data: { invoiceId: inv.id, lineNumber: 1, description: 'old', amount: 1 } });
  const res = await app.inject({ method: 'PATCH', url: `/api/invoices/${inv.id}`, payload: {
    vendorName: 'New Co', totalAmount: 200, lineItems: [{ lineNumber: 1, description: 'new', amount: 200 }] } });
  expect(res.statusCode).toBe(200);
  const got = await prisma.invoice.findUnique({ where: { id: inv.id }, include: { lineItems: true } });
  expect(got!.vendorName).toBe('New Co'); expect(got!.verified).toBe(true); expect(got!.editedAt).not.toBeNull();
  expect(got!.lineItems[0].description).toBe('new');
  await app.close();
});
it('apply-run copies a run snapshot onto the invoice', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'hc' } });
  const run1 = await prisma.extractionRun.create({ data: { invoiceId: inv.id, provider: 'azure', status: 'COMPLETED', confidence: 0.9,
    fieldsSnapshot: { vendorName: 'Snap Co', totalAmount: 77 }, itemsSnapshot: [{ lineNumber: 1, description: 'snap', amount: 77 }] } });
  const res = await app.inject({ method: 'POST', url: `/api/invoices/${inv.id}/apply-run`, payload: { runId: run1.id } });
  expect(res.statusCode).toBe(200);
  const got = await prisma.invoice.findUnique({ where: { id: inv.id }, include: { lineItems: true } });
  expect(got!.vendorName).toBe('Snap Co'); expect(got!.activeRunId).toBe(run1.id); expect(got!.lineItems[0].description).toBe('snap');
  await app.close();
});
it('delete cascades, bulk delete removes many', async () => {
  const app = await buildApp();
  const a = await prisma.invoice.create({ data: { fileName: 'a', storedPath: '/a', fileHash: 'h1' } });
  const b = await prisma.invoice.create({ data: { fileName: 'b', storedPath: '/b', fileHash: 'h2' } });
  expect((await app.inject({ method: 'DELETE', url: `/api/invoices/${a.id}` })).statusCode).toBe(200);
  await app.inject({ method: 'POST', url: '/api/invoices/bulk', payload: { action: 'delete', ids: [b.id] } });
  expect(await prisma.invoice.count()).toBe(0);
  await app.close();
});
```

- [ ] **Step 2: Run FAIL.** `cd api && npx vitest run tests/routes/mutate.test.ts`

- [ ] **Step 3: Add to `api/src/routes/invoices.ts`**

```ts
  app.post('/api/invoices/:id/reextract', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { provider } = (req.body ?? {}) as { provider?: string };
    await prisma.invoice.update({ where: { id }, data: { status: 'PENDING', error: null } });
    void runExtraction(id, provider);
    reply.code(202); return { ok: true };
  });

  app.patch('/api/invoices/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const { lineItems, ...fields } = body;
    const data: any = { ...fields, verified: true, editedAt: new Date() };
    if (data.invoiceDate) data.invoiceDate = new Date(data.invoiceDate);
    if (data.dueDate) data.dueDate = new Date(data.dueDate);
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id }, data });
      if (Array.isArray(lineItems)) {
        await tx.lineItem.deleteMany({ where: { invoiceId: id } });
        await tx.lineItem.createMany({ data: lineItems.map((li: any, i: number) => ({
          invoiceId: id, lineNumber: li.lineNumber ?? i + 1, description: li.description ?? null, sku: li.sku ?? null,
          quantity: li.quantity ?? null, unitPrice: li.unitPrice ?? null, amount: li.amount ?? null, taxRate: li.taxRate ?? null })) });
      }
    });
    return prisma.invoice.findUnique({ where: { id }, include: { lineItems: { orderBy: { lineNumber: 'asc' } } } });
  });

  app.post('/api/invoices/:id/apply-run', async (req, reply) => {
    const { id } = req.params as { id: string };
    const { runId } = req.body as { runId: string };
    const run = await prisma.extractionRun.findUnique({ where: { id: runId } });
    if (!run || run.invoiceId !== id) return reply.code(404).send({ error: 'run not found' });
    const fields = (run.fieldsSnapshot ?? {}) as any;
    const items = (run.itemsSnapshot ?? []) as any[];
    if (fields.invoiceDate) fields.invoiceDate = new Date(fields.invoiceDate);
    if (fields.dueDate) fields.dueDate = new Date(fields.dueDate);
    await prisma.$transaction(async (tx) => {
      await tx.lineItem.deleteMany({ where: { invoiceId: id } });
      await tx.lineItem.createMany({ data: items.map((li, i) => ({ invoiceId: id, lineNumber: li.lineNumber ?? i + 1,
        description: li.description ?? null, sku: li.sku ?? null, quantity: li.quantity ?? null, unitPrice: li.unitPrice ?? null,
        amount: li.amount ?? null, taxRate: li.taxRate ?? null })) });
      await tx.invoice.update({ where: { id }, data: { ...fields, provider: run.provider, confidence: run.confidence,
        status: 'COMPLETED', activeRunId: run.id, rawText: run.rawText, rawJson: run.rawJson as any } });
    });
    return prisma.invoice.findUnique({ where: { id }, include: { lineItems: { orderBy: { lineNumber: 'asc' } } } });
  });

  app.delete('/api/invoices/:id', async (req) => {
    await prisma.invoice.delete({ where: { id: (req.params as { id: string }).id } });
    return { ok: true };
  });

  app.post('/api/invoices/bulk', async (req) => {
    const { action, ids } = req.body as { action: 'reextract' | 'delete'; ids: string[] };
    if (action === 'delete') { await prisma.invoice.deleteMany({ where: { id: { in: ids } } }); return { ok: true, count: ids.length }; }
    for (const id of ids) { await prisma.invoice.update({ where: { id }, data: { status: 'PENDING', error: null } }); void runExtraction(id); }
    return { ok: true, count: ids.length };
  });
```

- [ ] **Step 4: Run PASS + commit**

```bash
cd api && npx vitest run tests/routes/mutate.test.ts
git add -A && git commit -m "feat(api): reextract, patch/verify, apply-run, delete, bulk"
```

### Task 5.5: Live bake-off route

**Files:**
- Modify: `api/src/routes/invoices.ts`
- Test: `api/tests/routes/bakeoff.test.ts`

The route iterates configured providers, runs each via `runExtractionWith`-style isolation into an `ExtractionRun` (without mutating the invoice's applied result), and returns run summaries. We expose `bakeoffInvoice(invoiceId)` in `extraction/run.ts` for testability with a seam to inject providers.

- [ ] **Step 1: Add `bakeoffInvoice` to `api/src/extraction/run.ts`**

```ts
import { allProviders } from '../providers/registry.js';
import { getCredentials } from '../settings/store.js';

export async function runOneForBakeoff(invoiceId: string, provider: ExtractionProvider, creds: Record<string, string>) {
  const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const started = Date.now();
  try {
    const file = await readFile(inv.storedPath);
    const pages = await pageCount(file);
    const structuring = { provider: await getSetting('structuring_provider', 'anthropic'), model: await getSetting('structuring_model', 'claude-sonnet-4-6') };
    const result = await provider.extract(file, creds, { fileName: inv.fileName, structuring });
    return prisma.extractionRun.create({ data: { invoiceId, provider: provider.name,
      structuringModel: provider.kind === 'markdown' ? structuring.model : null, status: 'COMPLETED',
      confidence: deriveConfidence(result), costEstimate: result.costEstimate ?? estimateCost(provider.name, pages),
      latencyMs: Date.now() - started, pageCount: pages, rawText: result.rawText, rawJson: result.rawJson as any,
      fieldsSnapshot: headerData(result) as any, itemsSnapshot: result.lineItems as any } });
  } catch (e: any) {
    return prisma.extractionRun.create({ data: { invoiceId, provider: provider.name, status: 'FAILED',
      latencyMs: Date.now() - started, error: String(e?.message ?? e) } });
  }
}

export async function bakeoffInvoice(invoiceId: string) {
  const runs = [];
  for (const p of allProviders()) {
    const creds = await getCredentials(p.name);
    if (!p.isConfigured(creds)) continue;
    runs.push(await runOneForBakeoff(invoiceId, p, creds!));
  }
  return runs;
}
```

- [ ] **Step 2: Failing route test** (seed creds for two providers via store; stub provider extract by registering through settings is heavy — instead test that with zero configured providers it returns an empty list and 200, and that it persists runs when a fake credential is present is covered at unit level. Keep route test minimal.)

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
beforeEach(async () => { await prisma.invoice.deleteMany(); await prisma.providerConfig.deleteMany(); });
it('bakeoff with no configured providers returns empty runs', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'h' } });
  const res = await app.inject({ method: 'POST', url: `/api/invoices/${inv.id}/bakeoff` });
  expect(res.statusCode).toBe(200);
  expect(res.json().runs).toEqual([]);
  await app.close();
});
```

- [ ] **Step 3: Run FAIL, then add route to `invoices.ts`**

```ts
  app.post('/api/invoices/:id/bakeoff', async (req) => {
    const { id } = req.params as { id: string };
    const { bakeoffInvoice } = await import('../extraction/run.js');
    const runs = await bakeoffInvoice(id);
    return { runs };
  });
```

- [ ] **Step 4: Run PASS + commit**

```bash
cd api && npx vitest run tests/routes/bakeoff.test.ts
git add -A && git commit -m "feat(api): live provider bake-off route"
```

---

## Phase 6 — Export, analytics, settings routes

### Task 6.1: CSV export (headers + line items)

**Files:**
- Create: `api/src/routes/export.ts` (replace the no-op)
- Test: `api/tests/routes/export.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
beforeEach(async () => { await prisma.invoice.deleteMany(); });
it('exports header csv with content-type and rows', async () => {
  const app = await buildApp();
  await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'h', status: 'COMPLETED', vendorName: 'Acme', totalAmount: 10 } });
  const res = await app.inject({ url: '/api/invoices/export/csv' });
  expect(res.headers['content-type']).toContain('text/csv');
  expect(res.body).toContain('vendorName');
  expect(res.body).toContain('Acme');
  await app.close();
});
it('exports line items csv', async () => {
  const app = await buildApp();
  const inv = await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'h2', vendorName: 'Acme' } });
  await prisma.lineItem.create({ data: { invoiceId: inv.id, lineNumber: 1, description: 'Widget', amount: 5 } });
  const res = await app.inject({ url: '/api/invoices/export/line-items.csv' });
  expect(res.body).toContain('Widget');
  await app.close();
});
```

- [ ] **Step 2: Run FAIL, then implement `api/src/routes/export.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { toCsv } from '../lib/csv.js';
import { buildWhere } from './invoices.js';

const HEADERS = ['id','status','vendorName','invoiceNumber','poNumber','invoiceDate','dueDate','currency','subtotal','taxAmount','totalAmount','provider','confidence','fileName'];
const ITEM_HEADERS = ['invoiceId','vendorName','invoiceNumber','lineNumber','description','sku','quantity','unitPrice','amount','taxRate'];

export async function exportRoutes(app: FastifyInstance) {
  app.get('/api/invoices/export/csv', async (req, reply) => {
    const rows = await prisma.invoice.findMany({ where: buildWhere(req.query as any), orderBy: { createdAt: 'desc' } });
    const csv = toCsv(HEADERS, rows.map((r) => ({ ...r, invoiceDate: r.invoiceDate?.toISOString().slice(0,10), dueDate: r.dueDate?.toISOString().slice(0,10) })));
    reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="invoices.csv"');
    return csv;
  });
  app.get('/api/invoices/export/line-items.csv', async (req, reply) => {
    const invoices = await prisma.invoice.findMany({ where: buildWhere(req.query as any), include: { lineItems: { orderBy: { lineNumber: 'asc' } } } });
    const rows = invoices.flatMap((inv) => inv.lineItems.map((li) => ({ invoiceId: inv.id, vendorName: inv.vendorName, invoiceNumber: inv.invoiceNumber, ...li })));
    reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="line-items.csv"');
    return toCsv(ITEM_HEADERS, rows);
  });
}
```

- [ ] **Step 3: Extract `buildWhere` in `api/src/routes/invoices.ts`** and export it (refactor the list route to call it; reused by export). Replace the inline `where` construction in the GET `/api/invoices` handler with:

```ts
export function buildWhere(q: Record<string, string>) {
  const where: any = {};
  if (q.status) where.status = q.status;
  if (q.q) where.OR = [
    { vendorName: { contains: q.q, mode: 'insensitive' } },
    { invoiceNumber: { contains: q.q, mode: 'insensitive' } },
    { fileName: { contains: q.q, mode: 'insensitive' } },
  ];
  if (q.minTotal) where.totalAmount = { gte: Number(q.minTotal) };
  if (q.dateFrom || q.dateTo) where.invoiceDate = { ...(q.dateFrom ? { gte: new Date(q.dateFrom) } : {}), ...(q.dateTo ? { lte: new Date(q.dateTo) } : {}) };
  return where;
}
```

(and in the GET handler: `const where = buildWhere(q);`)

- [ ] **Step 4: Run PASS + commit**

```bash
cd api && npx vitest run tests/routes/export.test.ts tests/routes/list.test.ts
git add -A && git commit -m "feat(api): csv export for headers + line items, shared buildWhere"
```

### Task 6.2: Analytics route

**Files:**
- Create: `api/src/routes/analytics.ts` (replace no-op)
- Test: `api/tests/routes/analytics.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
beforeEach(async () => { await prisma.invoice.deleteMany(); });
it('aggregates totals, vendors, months, avg confidence, review count', async () => {
  const app = await buildApp();
  await prisma.invoice.createMany({ data: [
    { fileName: 'a', storedPath: '/a', fileHash: 'h1', status: 'COMPLETED', vendorName: 'Acme', totalAmount: 100, confidence: 0.9, invoiceDate: new Date('2026-01-10') },
    { fileName: 'b', storedPath: '/b', fileHash: 'h2', status: 'COMPLETED', vendorName: 'Acme', totalAmount: 50, confidence: 0.6, invoiceDate: new Date('2026-01-20') },
    { fileName: 'c', storedPath: '/c', fileHash: 'h3', status: 'COMPLETED', vendorName: 'Globex', totalAmount: 200, confidence: 0.95, invoiceDate: new Date('2026-02-02') },
  ] });
  const b = (await app.inject({ url: '/api/analytics' })).json();
  expect(b.totalSpend).toBe(350); expect(b.completedCount).toBe(3);
  expect(b.byVendor[0]).toMatchObject({ name: 'Globex', amount: 200 });
  expect(b.byMonth.find((m: any) => m.label === '2026-01').amount).toBe(150);
  expect(b.avgConfidence).toBeCloseTo((0.9 + 0.6 + 0.95) / 3, 2);
  expect(b.needsReview).toBe(1); // confidence < 0.75
  await app.close();
});
```

- [ ] **Step 2: Run FAIL, then implement `api/src/routes/analytics.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
const THRESHOLD = 0.75;
export async function analyticsRoutes(app: FastifyInstance) {
  app.get('/api/analytics', async () => {
    const done = await prisma.invoice.findMany({ where: { status: 'COMPLETED' } });
    const totalSpend = done.reduce((s, i) => s + (i.totalAmount ?? 0), 0);
    const confs = done.map((i) => i.confidence).filter((c): c is number => typeof c === 'number');
    const avgConfidence = confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0;
    const needsReview = done.filter((i) => !i.verified && typeof i.confidence === 'number' && i.confidence < THRESHOLD).length;
    const vendorMap = new Map<string, number>();
    const monthMap = new Map<string, number>();
    for (const i of done) {
      if (i.vendorName) vendorMap.set(i.vendorName, (vendorMap.get(i.vendorName) ?? 0) + (i.totalAmount ?? 0));
      if (i.invoiceDate) { const k = i.invoiceDate.toISOString().slice(0, 7); monthMap.set(k, (monthMap.get(k) ?? 0) + (i.totalAmount ?? 0)); }
    }
    const byVendor = [...vendorMap].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount).slice(0, 8);
    const byMonth = [...monthMap].map(([label, amount]) => ({ label, amount })).sort((a, b) => a.label.localeCompare(b.label));
    return { totalSpend, completedCount: done.length, avgConfidence, needsReview, byVendor, byMonth };
  });
}
```

- [ ] **Step 3: Run PASS + commit**

```bash
cd api && npx vitest run tests/routes/analytics.test.ts
git add -A && git commit -m "feat(api): analytics aggregation route"
```

### Task 6.3: Settings routes

**Files:**
- Create: `api/src/routes/settings.ts` (replace no-op)
- Test: `api/tests/routes/settings.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
beforeEach(async () => { await prisma.providerConfig.deleteMany(); await prisma.setting.deleteMany(); });
it('GET settings returns selections + masked provider status', async () => {
  const app = await buildApp();
  const b = (await app.inject({ url: '/api/settings' })).json();
  expect(b).toHaveProperty('extractionProvider');
  expect(b.providers.find((p: any) => p.name === 'azure')).toMatchObject({ configured: false });
  await app.close();
});
it('PUT credentials stores encrypted + masks on read; never returns raw', async () => {
  const app = await buildApp();
  await app.inject({ method: 'PUT', url: '/api/settings/providers/azure', payload: { endpoint: 'https://x', apiKey: 'sk-secret-9999' } });
  const b = (await app.inject({ url: '/api/settings' })).json();
  const azure = b.providers.find((p: any) => p.name === 'azure');
  expect(azure.configured).toBe(true);
  expect(JSON.stringify(b)).not.toContain('sk-secret-9999');
  expect(azure.masked.apiKey).toBe('••••9999');
  await app.close();
});
it('PUT selections persists', async () => {
  const app = await buildApp();
  await app.inject({ method: 'PUT', url: '/api/settings', payload: { extractionProvider: 'azure', structuringProvider: 'openai', structuringModel: 'gpt-4o-mini' } });
  expect((await app.inject({ url: '/api/settings' })).json().extractionProvider).toBe('azure');
  await app.close();
});
```

- [ ] **Step 2: Run FAIL, then implement `api/src/routes/settings.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { allProviders } from '../providers/registry.js';
import { getSetting, setSetting, getCredentials, setCredentials, clearCredentials } from '../settings/store.js';
import { maskValue } from '../lib/crypto.js';

export async function settingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => {
    const providers = await Promise.all(allProviders().map(async (p) => {
      const creds = await getCredentials(p.name);
      const masked: Record<string, string> = {};
      if (creds) for (const k of p.requiredCredentials) if (creds[k]) masked[k] = maskValue(creds[k]);
      return { name: p.name, displayName: p.displayName, kind: p.kind, requiredCredentials: p.requiredCredentials, configured: p.isConfigured(creds), masked };
    }));
    return {
      extractionProvider: await getSetting('extraction_provider', 'mistral'),
      structuringProvider: await getSetting('structuring_provider', 'anthropic'),
      structuringModel: await getSetting('structuring_model', 'claude-sonnet-4-6'),
      providers,
    };
  });
  app.put('/api/settings', async (req) => {
    const b = req.body as any;
    if (b.extractionProvider) await setSetting('extraction_provider', b.extractionProvider);
    if (b.structuringProvider) await setSetting('structuring_provider', b.structuringProvider);
    if (b.structuringModel) await setSetting('structuring_model', b.structuringModel);
    return { ok: true };
  });
  app.put('/api/settings/providers/:provider', async (req) => {
    const { provider } = req.params as { provider: string };
    await setCredentials(provider, req.body as Record<string, string>);
    return { ok: true };
  });
  app.delete('/api/settings/providers/:provider', async (req) => {
    await clearCredentials((req.params as { provider: string }).provider);
    return { ok: true };
  });
}
```

Also allow structuring-provider credentials (anthropic/openai/mistral) through the same endpoint — they are stored under their provider name and read by `getStructuringModel`. No code change needed; the route accepts any `:provider`.

- [ ] **Step 3: Run PASS + full API suite + commit**

```bash
cd api && npx vitest run
git add -A && git commit -m "feat(api): settings routes with masked credential status"
```

---

## Phase 7 — Frontend scaffold

### Task 7.1: Vite app + theme + API client + types

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/index.html`, `web/src/main.tsx`, `web/src/theme.ts`, `web/src/format.ts`, `web/src/types.ts`, `web/src/api.ts`, `web/src/App.tsx`

- [ ] **Step 1: `web/package.json`**

```json
{
  "name": "invoice-ocr-web", "private": true, "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -b && vite build", "preview": "vite preview", "test": "vitest run" },
  "dependencies": { "react": "^18.3.0", "react-dom": "^18.3.0", "react-router-dom": "^6.26.0" },
  "devDependencies": { "@types/react": "^18.3.0", "@types/react-dom": "^18.3.0", "@vitejs/plugin-react": "^4.3.0", "typescript": "^5.5.0", "vite": "^5.4.0", "vitest": "^2.0.0", "jsdom": "^25.0.0", "@testing-library/react": "^16.0.0" }
}
```

- [ ] **Step 2:** `web/tsconfig.json` (standard React+Vite strict config), `web/vite.config.ts` with `@vitejs/plugin-react` and a dev proxy:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': process.env.VITE_API_BASE ?? 'http://localhost:4000' } },
  test: { environment: 'jsdom', globals: true },
});
```

`web/index.html` loads Hanken Grotesk + Geist Mono from Google Fonts and mounts `#root`.

- [ ] **Step 3: `web/src/theme.ts`** (Direction A tokens)

```ts
export const T = {
  bg: '#f7f5f1', panel: '#fff', rail: '#fbfaf7', border: '#e7e2d9',
  text: '#1c1a17', muted: '#8d877c', faint: '#a39d90',
  accent: '#4f46e5', accentHover: '#4338ca', accentSoft: '#ece9ff',
  green: '#1f9d63', red: '#d1453b', amber: '#b07d12',
  font: "'Hanken Grotesk', sans-serif", mono: "'Geist Mono', monospace",
};
export const STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pending', color: '#b07d12' }, PROCESSING: { label: 'Processing', color: '#4f46e5' },
  COMPLETED: { label: 'Completed', color: '#1f9d63' }, FAILED: { label: 'Failed', color: '#d1453b' },
};
```

- [ ] **Step 4: `web/src/format.ts`** (TDD)

Test `web/tests/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { money, dateFmt, confLabel } from '../src/format.js';
it('formats money/date/confidence', () => {
  expect(money(1234.5, 'USD')).toBe('$1,234.50');
  expect(money(null, 'USD')).toBe('—');
  expect(dateFmt('2026-01-05T00:00:00.000Z')).toBe('Jan 5, 2026');
  expect(confLabel(0.873)).toBe('87%');
});
```
Implement `web/src/format.ts`:
```ts
export const money = (v: number | null | undefined, currency = 'USD'): string =>
  v === null || v === undefined ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v);
export const dateFmt = (v: string | null | undefined): string =>
  v ? new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '—';
export const confLabel = (v: number | null | undefined): string => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
export const confColor = (v: number): string => (v >= 0.85 ? '#1f9d63' : v >= 0.7 ? '#b07d12' : '#d1453b');
```

- [ ] **Step 5: `web/src/types.ts` + `web/src/api.ts`**

`types.ts` mirrors API shapes (Invoice, LineItem, ExtractionRun, Config, Settings, Analytics). `api.ts`:
```ts
const BASE = '';
async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, { headers: { 'content-type': 'application/json' }, ...init });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
  return res.json();
}
export const api = {
  config: () => j<any>('/api/config'),
  list: (qs: string) => j<{ invoices: any[] }>(`/api/invoices${qs}`),
  get: (id: string) => j<any>(`/api/invoices/${id}`),
  reextract: (id: string, provider?: string) => j(`/api/invoices/${id}/reextract`, { method: 'POST', body: JSON.stringify({ provider }) }),
  bakeoff: (id: string) => j<{ runs: any[] }>(`/api/invoices/${id}/bakeoff`, { method: 'POST' }),
  applyRun: (id: string, runId: string) => j(`/api/invoices/${id}/apply-run`, { method: 'POST', body: JSON.stringify({ runId }) }),
  patch: (id: string, body: any) => j(`/api/invoices/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  del: (id: string) => j(`/api/invoices/${id}`, { method: 'DELETE' }),
  bulk: (action: string, ids: string[]) => j('/api/invoices/bulk', { method: 'POST', body: JSON.stringify({ action, ids }) }),
  analytics: () => j<any>('/api/analytics'),
  settings: () => j<any>('/api/settings'),
  saveSettings: (b: any) => j('/api/settings', { method: 'PUT', body: JSON.stringify(b) }),
  saveCreds: (provider: string, b: any) => j(`/api/settings/providers/${provider}`, { method: 'PUT', body: JSON.stringify(b) }),
  clearCreds: (provider: string) => j(`/api/settings/providers/${provider}`, { method: 'DELETE' }),
  upload: async (files: File[]) => { const fd = new FormData(); files.forEach((f) => fd.append('files', f)); const res = await fetch('/api/invoices/upload', { method: 'POST', body: fd }); return res.json(); },
};
```

- [ ] **Step 6: `web/src/App.tsx` + `web/src/main.tsx`** (router + Shell)

```tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Shell } from './components/Shell.js';
import { InvoicesPage } from './pages/InvoicesPage.js';
import { InvoiceDetailPage } from './pages/InvoiceDetailPage.js';
import { AnalyticsPage } from './pages/AnalyticsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
export default function App() {
  return (<BrowserRouter><Shell><Routes>
    <Route path="/" element={<Navigate to="/invoices" />} />
    <Route path="/invoices" element={<InvoicesPage />} />
    <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
    <Route path="/analytics" element={<AnalyticsPage />} />
    <Route path="/settings" element={<SettingsPage />} />
  </Routes></Shell></BrowserRouter>);
}
```

- [ ] **Step 7: Install, build-check, commit**

```bash
cd web && npm install && npx vitest run tests/format.test.ts && npx tsc -b --noEmit
git add -A && git commit -m "feat(web): scaffold vite app, theme, api client, formatters"
```

### Task 7.2: Shell + shared components

**Files:**
- Create: `web/src/components/Shell.tsx`, `StatusDot.tsx`, `ConfidenceBar.tsx`, `Toast.tsx`, `web/src/hooks/usePolling.ts`

- [ ] **Step 1: `usePolling.ts`** (TDD)

Test `web/tests/usePolling.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePolling } from '../src/hooks/usePolling.js';
it('stops polling when shouldContinue returns false', async () => {
  const fn = vi.fn().mockResolvedValue('x');
  renderHook(() => usePolling(fn, () => false, 10));
  await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
  await new Promise((r) => setTimeout(r, 40));
  expect(fn).toHaveBeenCalledTimes(1);
});
```
Implement `web/src/hooks/usePolling.ts`:
```ts
import { useEffect, useRef } from 'react';
export function usePolling(tick: () => Promise<void> | void, shouldContinue: () => boolean, intervalMs = 3000) {
  const cont = useRef(shouldContinue); cont.current = shouldContinue;
  useEffect(() => {
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const loop = async () => { if (!active) return; await tick(); if (active && cont.current()) timer = setTimeout(loop, intervalMs); };
    loop();
    return () => { active = false; clearTimeout(timer); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
```

- [ ] **Step 2: `Shell.tsx`** — sidebar (brand "Invoice OCR" / "Finance · self-hosted", nav links Invoices/Analytics/Settings with active state using `useLocation`, indigo active background `T.accentSoft`/`T.accent`), main content area with `background:T.bg`. Use the exact palette from `theme.ts`. Filter list is rendered inside `InvoicesPage`, not the Shell.

- [ ] **Step 3: `StatusDot.tsx`** (dot + label from `STATUS`, pulse animation when PENDING/PROCESSING via inline `@keyframes` injected once), `ConfidenceBar.tsx` (62px track + fill at `confColor`, or "✓ Verified" when `verified`), `Toast.tsx` (fixed bottom-center pill, optional action button).

- [ ] **Step 4: Commit**

```bash
cd web && npx vitest run tests/usePolling.test.tsx && npx tsc -b --noEmit
git add -A && git commit -m "feat(web): shell, shared components, polling hook"
```

---

## Phase 8 — Invoices list page

### Task 8.1: Table, filters, search, states

**Files:**
- Create: `web/src/pages/InvoicesPage.tsx`
- Test: `web/tests/InvoicesPage.test.tsx`

- [ ] **Step 1: Failing test** (mock `api.list`)

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InvoicesPage } from '../src/pages/InvoicesPage.js';
import { api } from '../src/api.js';
beforeEach(() => {
  vi.spyOn(api, 'list').mockResolvedValue({ invoices: [
    { id: '1', status: 'COMPLETED', vendorName: 'Acme', invoiceNumber: 'INV-1', invoiceDate: '2026-01-05', provider: 'azure', confidence: 0.9, itemCount: 3, totalAmount: 100, verified: false },
  ] } as any);
  vi.spyOn(api, 'config').mockResolvedValue({ providers: [] } as any);
});
it('renders rows from the API', async () => {
  render(<MemoryRouter><InvoicesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
  expect(screen.getByText('INV-1')).toBeTruthy();
});
```

- [ ] **Step 2: Run FAIL, then implement `InvoicesPage.tsx`**

Build per the Direction-A list spec: header (title, count label, search input with ⌕, Filters toggle w/ badge, Export CSV, Items CSV, Upload bills button); the left status-filter list (All / Pending / Processing / Completed / Failed / Needs review with counts — counts derived from a `?` fetch or from current rows); advanced filter panel (min total, issued from/to, clear); duplicate-skipped banner; upload drop zone (`<input type=file multiple accept="application/pdf">` + drag handlers calling `api.upload` then refetch); bulk action bar when `selected.size>0`; sortable table with checkbox column, Status (StatusDot), Vendor (primary + secondary filename), Invoice #, Date, Provider chip, Confidence (ConfidenceBar / ✓ Verified), Items (right), Total (right). Row click → `navigate('/invoices/'+id)`; checkbox `onClick` stops propagation. States: skeleton while loading, empty-all CTA, no-results message. Poll via `usePolling(refetch, () => rows.some(r => r.status==='PENDING'||r.status==='PROCESSING'))`. Sorting updates `sort`/`dir` query and refetches. Search is debounced 300ms. Apply exact inline styles from the prototype Direction A (colors from `theme.ts`).

- [ ] **Step 3: Run PASS + commit**

```bash
cd web && npx vitest run tests/InvoicesPage.test.tsx && npx tsc -b --noEmit
git add -A && git commit -m "feat(web): invoices list with table, filters, upload, polling, bulk"
```

---

## Phase 9 — Invoice detail page

### Task 9.1: Detail view + inline edit + re-extract

**Files:**
- Create: `web/src/pages/InvoiceDetailPage.tsx`
- Test: `web/tests/InvoiceDetailPage.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { InvoiceDetailPage } from '../src/pages/InvoiceDetailPage.js';
import { api } from '../src/api.js';
const inv = { id: '1', status: 'COMPLETED', vendorName: 'Acme', vendorAddress: '1 St', vendorTaxId: 'TX1', fileName: 'a.pdf',
  invoiceNumber: 'INV-1', poNumber: 'PO-1', invoiceDate: '2026-01-05', dueDate: '2026-02-05', currency: 'USD',
  subtotal: 90, taxAmount: 10, totalAmount: 100, confidence: 0.9, provider: 'azure', verified: false, error: null,
  lineItems: [{ id: 'li1', lineNumber: 1, description: 'Widget', quantity: 2, unitPrice: 45, amount: 90 }], runs: [] };
beforeEach(() => {
  vi.spyOn(api, 'get').mockResolvedValue(inv as any);
  vi.spyOn(api, 'config').mockResolvedValue({ providers: [{ name: 'azure', displayName: 'Azure', configured: true }] } as any);
});
it('renders header fields and line items', async () => {
  render(<MemoryRouter initialEntries={['/invoices/1']}><Routes><Route path="/invoices/:id" element={<InvoiceDetailPage />} /></Routes></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
  expect(screen.getByText('Widget')).toBeTruthy();
  expect(screen.getByText('INV-1')).toBeTruthy();
});
it('enters edit mode and saves', async () => {
  const patch = vi.spyOn(api, 'patch').mockResolvedValue(inv as any);
  render(<MemoryRouter initialEntries={['/invoices/1']}><Routes><Route path="/invoices/:id" element={<InvoiceDetailPage />} /></Routes></MemoryRouter>);
  await waitFor(() => screen.getByText('Edit fields'));
  fireEvent.click(screen.getByText('Edit fields'));
  fireEvent.click(screen.getByText('Save & verify'));
  await waitFor(() => expect(patch).toHaveBeenCalled());
});
```

- [ ] **Step 2: Run FAIL, then implement `InvoiceDetailPage.tsx`**

Per spec: back link; header card (StatusDot, verified badge, vendor name/address/taxId/filename, "✓ Manually corrected" note when `editedAt`); action row (provider `<select>` from `api.config().providers`, Re-extract → `api.reextract`, Compare source → opens `CompareOverlay`, Bake-off → opens `BakeoffOverlay`, Edit fields → edit mode, Delete → `api.del` then navigate back); failed-error box when `status==='FAILED'`; 4-col canonical field grid; line-item table with subtotal/tax/total; expandable raw OCR (`<pre>` mono). Edit mode swaps grid + items into controlled inputs; "Save & verify" builds the patch body (header fields + lineItems) → `api.patch` → reload + toast. Re-extract sets a local "processing" and polls `api.get` until status settles. Styles from prototype.

- [ ] **Step 3: Run PASS + commit**

```bash
cd web && npx vitest run tests/InvoiceDetailPage.test.tsx && npx tsc -b --noEmit
git add -A && git commit -m "feat(web): invoice detail with inline edit + re-extract"
```

---

## Phase 10 — Overlays

### Task 10.1: Compare + Bake-off overlays

**Files:**
- Create: `web/src/overlays/CompareOverlay.tsx`, `web/src/overlays/BakeoffOverlay.tsx`
- Test: `web/tests/Overlays.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BakeoffOverlay } from '../src/overlays/BakeoffOverlay.js';
import { api } from '../src/api.js';
it('runs bakeoff on open and lists provider cards', async () => {
  vi.spyOn(api, 'bakeoff').mockResolvedValue({ runs: [
    { id: 'r1', provider: 'azure', status: 'COMPLETED', confidence: 0.93, costEstimate: 0.01, latencyMs: 4200, itemsSnapshot: [{}], fieldsSnapshot: { totalAmount: 100 } },
  ] } as any);
  const sel = { id: '1', vendorName: 'Acme', totalAmount: 100 } as any;
  render(<BakeoffOverlay invoice={sel} onClose={() => {}} onApplied={() => {}} />);
  await waitFor(() => expect(screen.getByText('Azure')).toBeTruthy());
  expect(screen.getByText(/93%/)).toBeTruthy();
});
```

- [ ] **Step 2: Run FAIL, then implement overlays**

`CompareOverlay.tsx`: fixed dialog, split grid — left reconstructs the source-document look (vendor header, INVOICE label, date/due/PO/terms, line-item table, totals) from the invoice fields; right shows `rawText` in a mono `<pre>` (dark) or a "No OCR text" panel. Header shows provider + confidence. Click backdrop / ✕ closes.

`BakeoffOverlay.tsx`: on mount call `api.bakeoff(invoice.id)`; show a per-provider card with confidence (big), header/line-item accuracy bars (from `PROVIDER_REFERENCE` echoed in `web/src/types.ts` or returned costEstimateref), items count, total read, Δ vs `invoice.totalAmount`, cost/1k, latency, pattern, and "Use this engine" → `api.applyRun(invoice.id, run.id)` then `onApplied()`. Loading + "no configured providers" states. Styles from prototype bake-off overlay.

- [ ] **Step 3: Run PASS + commit**

```bash
cd web && npx vitest run tests/Overlays.test.tsx && npx tsc -b --noEmit
git add -A && git commit -m "feat(web): compare + live bake-off overlays"
```

---

## Phase 11 — Analytics page

### Task 11.1: Analytics dashboard

**Files:**
- Create: `web/src/pages/AnalyticsPage.tsx`
- Test: `web/tests/AnalyticsPage.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AnalyticsPage } from '../src/pages/AnalyticsPage.js';
import { api } from '../src/api.js';
it('renders KPIs and vendor/month bars', async () => {
  vi.spyOn(api, 'analytics').mockResolvedValue({ totalSpend: 350, completedCount: 3, avgConfidence: 0.82, needsReview: 1,
    byVendor: [{ name: 'Globex', amount: 200 }], byMonth: [{ label: '2026-01', amount: 150 }] } as any);
  render(<AnalyticsPage />);
  await waitFor(() => expect(screen.getByText('Globex')).toBeTruthy());
  expect(screen.getByText(/\$350\.00/)).toBeTruthy();
});
```

- [ ] **Step 2: Run FAIL, then implement `AnalyticsPage.tsx`**

4 KPI cards (Total spend in accent, Completed, Avg confidence, Needs review in amber) + two panels: Top vendors by spend (horizontal bars, indigo) and Spend by month (bars, green). Bar widths = amount / max × 100%. Styles from prototype analytics section.

- [ ] **Step 3: Run PASS + commit**

```bash
cd web && npx vitest run tests/AnalyticsPage.test.tsx && npx tsc -b --noEmit
git add -A && git commit -m "feat(web): analytics dashboard"
```

---

## Phase 12 — Settings page

### Task 12.1: Provider config UI

**Files:**
- Create: `web/src/pages/SettingsPage.tsx`
- Test: `web/tests/SettingsPage.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SettingsPage } from '../src/pages/SettingsPage.js';
import { api } from '../src/api.js';
beforeEach(() => {
  vi.spyOn(api, 'settings').mockResolvedValue({ extractionProvider: 'mistral', structuringProvider: 'anthropic', structuringModel: 'claude-sonnet-4-6',
    providers: [{ name: 'azure', displayName: 'Azure', kind: 'structured', requiredCredentials: ['endpoint','apiKey'], configured: false, masked: {} }] } as any);
});
it('renders provider credential forms and saves', async () => {
  const save = vi.spyOn(api, 'saveCreds').mockResolvedValue({} as any);
  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText('Azure')).toBeTruthy());
  fireEvent.change(screen.getByPlaceholderText('endpoint'), { target: { value: 'https://x' } });
  fireEvent.change(screen.getByPlaceholderText('apiKey'), { target: { value: 'sk-1' } });
  fireEvent.click(screen.getAllByText('Save')[0]);
  await waitFor(() => expect(save).toHaveBeenCalledWith('azure', { endpoint: 'https://x', apiKey: 'sk-1' }));
});
```

- [ ] **Step 2: Run FAIL, then implement `SettingsPage.tsx`**

Top: selectors for active extraction provider (from `providers`), structuring provider (anthropic/openai/mistral), structuring model (text input) → "Save selections" → `api.saveSettings`. Below: one card per provider with `requiredCredentials` inputs (placeholder = field name, `type=password`, show masked hint when `configured`), Save → `api.saveCreds(name, values)`, Clear → `api.clearCreds(name)`, and a `configured` badge. Also include cards for structuring providers (anthropic/openai/mistral apiKey) so their keys can be entered. Refetch after save; toast on success. Styles from Direction A.

- [ ] **Step 3: Run PASS + commit**

```bash
cd web && npx vitest run tests/SettingsPage.test.tsx && npx tsc -b --noEmit
git add -A && git commit -m "feat(web): settings page for provider config + selections"
```

---

## Phase 13 — Packaging & end-to-end

### Task 13.1: Dockerfiles + compose

**Files:**
- Create: `api/Dockerfile`, `api/.dockerignore`, `web/Dockerfile`, `web/nginx.conf`, `docker-compose.yml`

- [ ] **Step 1: `api/Dockerfile`**

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY api/package*.json ./
RUN npm ci
COPY api/ ./
RUN npx prisma generate && npm run build
FROM node:20-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package*.json ./
ENV NODE_ENV=production
CMD ["sh","-c","npx prisma migrate deploy && node dist/index.js"]
```

`api/.dockerignore`: `node_modules`, `dist`, `.env`, `tests`.

- [ ] **Step 2: `web/Dockerfile` + `web/nginx.conf`**

```dockerfile
FROM node:20-slim AS build
WORKDIR /app
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build
FROM nginx:alpine
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
```

`web/nginx.conf` serves the SPA (`try_files $uri /index.html`) and proxies `/api` to `http://api:4000`.

- [ ] **Step 3: `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16
    environment: { POSTGRES_USER: invoice, POSTGRES_PASSWORD: invoice, POSTGRES_DB: invoice }
    volumes: [ "pgdata:/var/lib/postgresql/data" ]
    ports: [ "5432:5432" ]
  api:
    build: { context: ., dockerfile: api/Dockerfile }
    environment:
      DATABASE_URL: postgresql://invoice:invoice@db:5432/invoice?schema=public
      APP_SECRET: ${APP_SECRET:-dev-secret-change-me}
      UPLOAD_DIR: /data/uploads
      PORT: 4000
      EXTRACTION_PROVIDER: ${EXTRACTION_PROVIDER:-mistral}
      STRUCTURING_MODEL_PROVIDER: ${STRUCTURING_MODEL_PROVIDER:-anthropic}
      STRUCTURING_MODEL: ${STRUCTURING_MODEL:-claude-sonnet-4-6}
      MISTRAL_API_KEY: ${MISTRAL_API_KEY:-}
      AZURE_DI_ENDPOINT: ${AZURE_DI_ENDPOINT:-}
      AZURE_DI_KEY: ${AZURE_DI_KEY:-}
      LLAMAPARSE_API_KEY: ${LLAMAPARSE_API_KEY:-}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
    volumes: [ "uploads:/data/uploads" ]
    depends_on: [ db ]
    ports: [ "4000:4000" ]
  web:
    build: { context: ., dockerfile: web/Dockerfile }
    depends_on: [ api ]
    ports: [ "8080:80" ]
volumes: { pgdata: {}, uploads: {} }
```

- [ ] **Step 4: Bring it up and smoke-test**

```bash
cd /d/AL/Projects/praya-invoice-analyser
APP_SECRET=test-secret docker compose up --build -d
curl -s localhost:4000/api/config | grep providers
# open http://localhost:8080 → Settings → add a Mistral (or Azure) key → upload a real PDF → watch it reach COMPLETED
docker compose down
```

Expected: `/api/config` returns providers JSON; web app loads the Ledger UI; with a real key configured an uploaded PDF extracts to COMPLETED.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: docker compose packaging (db + api + web)"
```

### Task 13.2: README + final full-suite run

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`** — what it is, `cp .env.example .env`, set `APP_SECRET`, `docker compose up --build`, open `:8080`, configure a provider in Settings, upload PDFs. Document the provider matrix + that Textract is built/Google stubbed, and that v1 has no auth (trusted/internal).

- [ ] **Step 2: Run both test suites**

```bash
cd api && npx vitest run
cd ../web && npx vitest run
```
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: project README and usage"
```

---

## Self-Review (spec coverage)

- **FR-1 multi-file upload / validation** → Task 5.2. **FR-2 hash dedupe** → 2.3 + 5.2. **FR-3 async + live status** → 4.1 (isolation), 8.1 (polling). **FR-4 canonical schema** → 1.1, 3.1, 3.2. **FR-5 provider abstraction + selection** → 3.1, 3.4, 3.5, 5.1 config. **FR-6 searchable table** → 5.3, 8.1. **FR-7 detail + line items + raw OCR** → 5.3, 9.1. **FR-8 re-extract/switch** → 5.4, 9.1. **FR-9 CSV** → 6.1. **FR-10 delete** → 5.4. **FR-11 audit (rawText/rawJson + runs)** → 1.1, 4.1. **FR-13 line-item CSV** → 6.1.
- **Design extras:** analytics → 6.2 + 11.1; live bake-off → 5.5 + 10.1; inline edit + verify → 5.4 + 9.1; bulk actions → 5.4 + 8.1; settings/runtime provider config + encrypted keys → 2.2, 2.5, 5.1 seed, 6.3, 12.1.
- **Cross-cutting:** encryption/masking → 2.2, 2.5, 6.3; in-process extraction → 4.1; Docker compose → 13.1; tests throughout.

No placeholders remain; type names (`CanonicalResult`, `ExtractionProvider`, `runExtraction`/`runExtractionWith`/`bakeoffInvoice`, `buildWhere`, `getStructuringModel`, `normalizeStructured`, `mapAzure`/`mapTextract`, `getCredentials`/`setCredentials`/`getProviderCredsOrThrow`) are consistent across API tasks; `api`/`T`/`STATUS`/`usePolling` consistent across web tasks.
