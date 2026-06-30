# Upload Batches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tag every upload as a named "batch" so invoices uploaded together can be filtered, see a live progress roll-up, and show a per-row batch tag on the Invoices page.

**Architecture:** Add a `Batch` Prisma model with a nullable `Invoice.batchId` link. The upload route creates one batch per request, names it (default timestamp or a `batchName` form field), tags each created invoice, and deletes the batch if nothing was created. A new `GET /api/batches` returns per-batch status roll-ups via `groupBy`. The Invoices page (which already loads all invoices and filters client-side) gains a batch-name upload input, a batch dropdown filter, a progress banner, and a per-row chip; it reads batch roll-ups from `GET /api/batches`.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL 16, Vitest (api + jsdom web), React 18 + Vite.

**Spec:** `docs/superpowers/specs/2026-06-23-upload-batches-design.md`

**Conventions to follow:**
- API tests use `buildApp()` + `app.inject()`, talk to a live Postgres via `prisma`, and mock `runExtraction` (see `api/tests/routes/upload.test.ts`).
- The test schema is applied by `globalSetup.ts` running `npx prisma migrate deploy` — so a **committed migration file** is mandatory.
- The Invoices page loads ALL invoices via `api.list('')` and filters/sorts **client-side**; batch filtering follows the same client-side pattern (consistent with the status pills).

---

### Task 1: Data model — `Batch` + `Invoice.batchId` + migration

**Files:**
- Modify: `api/prisma/schema.prisma`
- Create: `api/prisma/migrations/<timestamp>_add_batches/migration.sql` (generated)

- [ ] **Step 1: Add the `Batch` model and link it from `Invoice`**

In `api/prisma/schema.prisma`, add this model after the `LineItem` model (anywhere among the models is fine):

```prisma
model Batch {
  id        String    @id @default(cuid())
  name      String
  createdAt DateTime  @default(now())
  invoices  Invoice[]
}
```

Then add the relation fields to `model Invoice`. Insert these two lines just after the `activeRunId String?` line (line ~48), and the index with the other `@@index` lines:

```prisma
  batchId       String?
  batch         Batch?        @relation(fields: [batchId], references: [id], onDelete: SetNull)
```

```prisma
  @@index([batchId])
```

- [ ] **Step 2: Generate and apply the migration**

Ensure the dev Postgres is reachable and `api/.env`'s `DATABASE_URL` points at it (default `postgresql://invoice:invoice@localhost:5432/invoice?schema=public`). From the `api/` directory:

Run: `npx prisma migrate dev --name add_batches`
Expected: Prisma creates `prisma/migrations/<timestamp>_add_batches/migration.sql`, applies it, and regenerates the client. Output ends with "Your database is now in sync with your schema."

- [ ] **Step 3: Verify the generated SQL**

Open the new `migration.sql`. Expected: a `CREATE TABLE "Batch"` statement, an `ALTER TABLE "Invoice" ADD COLUMN "batchId" TEXT`, a `CREATE INDEX "Invoice_batchId_idx"`, and a foreign key from `Invoice.batchId` → `Batch.id` with `ON DELETE SET NULL`.

- [ ] **Step 4: Confirm the suite still compiles/passes against the new schema**

Run: `npm test` (in `api/`)
Expected: existing tests still PASS (the test DB picks up the migration via `migrate deploy` in `globalSetup.ts`).

- [ ] **Step 5: Commit**

```bash
git add api/prisma/schema.prisma api/prisma/migrations
git commit -m "feat(db): add Batch model and Invoice.batchId link"
```

---

### Task 2: Upload route creates, names, tags, and cleans up a batch

**Files:**
- Modify: `api/src/routes/invoices.ts:26-44` (the `/api/invoices/upload` handler)
- Test: `api/tests/routes/upload.test.ts`

- [ ] **Step 1: Write failing tests**

Replace the contents of `api/tests/routes/upload.test.ts` with the version below. It extends the multipart helper to support an optional `batchName` field and multiple files, keeps the existing two tests, and adds batch assertions.

```ts
import { it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { PDFDocument } from 'pdf-lib';
import * as run from '../../src/extraction/run.js';

async function pdf(): Promise<Buffer> { const d = await PDFDocument.create(); d.addPage(); return Buffer.from(await d.save()); }

// Build a multipart body with an optional batchName field followed by N file parts.
function form(files: { buf: Buffer; name: string }[], batchName?: string) {
  const b = '----t';
  const chunks: Buffer[] = [];
  if (batchName !== undefined) {
    chunks.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="batchName"\r\n\r\n${batchName}\r\n`));
  }
  for (const f of files) {
    chunks.push(Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/pdf\r\n\r\n`));
    chunks.push(f.buf);
    chunks.push(Buffer.from('\r\n'));
  }
  chunks.push(Buffer.from(`--${b}--\r\n`));
  return { payload: Buffer.concat(chunks), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

beforeEach(async () => {
  await prisma.invoice.deleteMany();
  await prisma.batch.deleteMany();
  vi.spyOn(run, 'runExtraction').mockResolvedValue();
});

it('creates an invoice and skips duplicate by hash', async () => {
  const app = await buildApp(); const buf = await pdf();
  const r1 = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf, name: 'x.pdf' }]) });
  expect(r1.statusCode).toBe(201);
  expect(r1.json().created).toHaveLength(1);
  const r2 = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf, name: 'x.pdf' }]) });
  expect(r2.json().created).toHaveLength(0);
  expect(r2.json().duplicates).toHaveLength(1);
  expect(await prisma.invoice.count()).toBe(1);
  await app.close();
});

it('rejects a non-pdf file', async () => {
  const app = await buildApp();
  const r = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf: Buffer.from('hello'), name: 'x.pdf' }]) });
  expect(r.json().rejected).toHaveLength(1);
  await app.close();
});

it('creates one batch and tags every created invoice with it', async () => {
  const app = await buildApp();
  const r = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf: await pdf(), name: 'a.pdf' }, { buf: await pdf(), name: 'b.pdf' }]) });
  const body = r.json();
  expect(body.created).toHaveLength(2);
  expect(body.batchId).toBeTruthy();
  expect(await prisma.batch.count()).toBe(1);
  const invs = await prisma.invoice.findMany();
  expect(invs.every((i) => i.batchId === body.batchId)).toBe(true);
  await app.close();
});

it('uses the batchName field as the batch name, else a default', async () => {
  const app = await buildApp();
  const named = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf: await pdf(), name: 'a.pdf' }], 'April bills') });
  expect((await prisma.batch.findUnique({ where: { id: named.json().batchId } }))!.name).toBe('April bills');

  const unnamed = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf: await pdf(), name: 'b.pdf' }]) });
  expect((await prisma.batch.findUnique({ where: { id: unnamed.json().batchId } }))!.name).toMatch(/^Upload /);
  await app.close();
});

it('leaves no empty batch when every file is a duplicate', async () => {
  const app = await buildApp(); const buf = await pdf();
  await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf, name: 'x.pdf' }]) }); // 1 invoice, 1 batch
  const before = await prisma.batch.count();
  const r = await app.inject({ method: 'POST', url: '/api/invoices/upload', ...form([{ buf, name: 'x.pdf' }]) }); // duplicate
  expect(r.json().created).toHaveLength(0);
  expect(await prisma.batch.count()).toBe(before); // the new (empty) batch was deleted
  await app.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/routes/upload.test.ts` (in `api/`)
Expected: the three new tests FAIL (e.g. `body.batchId` is undefined; `prisma.batch` table queried but route doesn't create one).

- [ ] **Step 3: Implement the batch logic in the upload handler**

Replace the upload handler (`api/src/routes/invoices.ts:26-44`) with:

```ts
  app.post('/api/invoices/upload', async (req, reply) => {
    await mkdir(env.uploadDir, { recursive: true });
    const created: any[] = []; const duplicates: any[] = []; const rejected: any[] = [];
    // One batch per upload request. Default name is a UTC timestamp; an optional
    // `batchName` form field (in any order) overrides it. Cleaned up if nothing lands.
    const defaultName = 'Upload ' + new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const batch = await prisma.batch.create({ data: { name: defaultName } });
    for await (const part of (req as any).parts()) {
      if (part.type === 'field' && part.fieldname === 'batchName' && part.value) {
        await prisma.batch.update({ where: { id: batch.id }, data: { name: String(part.value) } });
        continue;
      }
      if (part.type !== 'file') continue;
      const buf = await part.toBuffer();
      if (!isPdf(buf)) { rejected.push({ fileName: part.filename, reason: 'not a PDF' }); continue; }
      const hash = sha256(buf);
      const existing = await prisma.invoice.findUnique({ where: { fileHash: hash } });
      if (existing) { duplicates.push({ fileName: part.filename, id: existing.id }); continue; }
      const storedPath = join(env.uploadDir, `${hash}.pdf`);
      await writeFile(storedPath, buf);
      const inv = await prisma.invoice.create({ data: { fileName: part.filename, storedPath, fileHash: hash, batchId: batch.id } });
      created.push(inv);
      void runExtraction(inv.id);
    }
    if (created.length === 0) await prisma.batch.delete({ where: { id: batch.id } });
    reply.code(201);
    return { created, duplicates, rejected, batchId: created.length ? batch.id : null, batch: created.length ? batch : null };
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/routes/upload.test.ts` (in `api/`)
Expected: all five tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/routes/invoices.ts api/tests/routes/upload.test.ts
git commit -m "feat(api): tag each upload with a named batch"
```

---

### Task 3: `GET /api/batches` roll-up endpoint

**Files:**
- Create: `api/src/routes/batches.ts`
- Modify: `api/src/app.ts` (register the route)
- Test: `api/tests/routes/batches.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/tests/routes/batches.test.ts`:

```ts
import { it, expect, beforeEach } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';

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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/routes/batches.test.ts` (in `api/`)
Expected: FAIL with 404 (route not registered) → `batches` is undefined.

- [ ] **Step 3: Implement the route**

Create `api/src/routes/batches.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

// Per-batch processing roll-up: total invoices and how many are COMPLETED / FAILED /
// still in flight (PENDING or PROCESSING). Powers the batch dropdown + progress banner.
export async function batchesRoutes(app: FastifyInstance) {
  app.get('/api/batches', async () => {
    const batches = await prisma.batch.findMany({ orderBy: { createdAt: 'desc' } });
    const grouped = await prisma.invoice.groupBy({
      by: ['batchId', 'status'],
      where: { batchId: { not: null } },
      _count: { _all: true },
    });
    return {
      batches: batches.map((b) => {
        let total = 0, completed = 0, failed = 0, processing = 0;
        for (const g of grouped) {
          if (g.batchId !== b.id) continue;
          const c = g._count._all;
          total += c;
          if (g.status === 'COMPLETED') completed += c;
          else if (g.status === 'FAILED') failed += c;
          else processing += c; // PENDING or PROCESSING
        }
        return { id: b.id, name: b.name, createdAt: b.createdAt, total, completed, failed, processing };
      }),
    };
  });
}
```

- [ ] **Step 4: Register the route in `app.ts`**

In `api/src/app.ts`, add the import after the other route imports (line ~8):

```ts
import { batchesRoutes } from './routes/batches.js';
```

And register it after `invoiceRoutes` (line ~15):

```ts
  await app.register(batchesRoutes);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/routes/batches.test.ts` (in `api/`)
Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/batches.ts api/src/app.ts api/tests/routes/batches.test.ts
git commit -m "feat(api): add GET /api/batches roll-up endpoint"
```

---

### Task 4: Invoice list — `batchId` filter + include batch name

**Files:**
- Modify: `api/src/routes/invoices.ts:12-23` (`buildWhere`), `:52-59` (list include), `:70-71` (detail include)
- Test: `api/tests/routes/list.test.ts`

- [ ] **Step 1: Write the failing test**

Append these tests to `api/tests/routes/list.test.ts` (keep the existing two):

```ts
it('filters invoices by batchId and includes the batch name', async () => {
  const app = await buildApp();
  const b = await prisma.batch.create({ data: { name: 'April bills' } });
  await prisma.invoice.create({ data: { fileName: 'a.pdf', storedPath: '/a', fileHash: 'qa', batchId: b.id, status: 'COMPLETED' } });
  await prisma.invoice.create({ data: { fileName: 'b.pdf', storedPath: '/b', fileHash: 'qb', status: 'COMPLETED' } }); // no batch

  const all = (await app.inject({ url: '/api/invoices' })).json().invoices;
  expect(all).toHaveLength(2);

  const filtered = (await app.inject({ url: `/api/invoices?batchId=${b.id}` })).json().invoices;
  expect(filtered).toHaveLength(1);
  expect(filtered[0].batch).toMatchObject({ id: b.id, name: 'April bills' });
  await app.close();
});
```

Add `await prisma.batch.deleteMany();` to the existing `beforeEach` in this file so batches don't leak between tests:

```ts
beforeEach(async () => { await prisma.invoice.deleteMany(); await prisma.batch.deleteMany(); });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/routes/list.test.ts` (in `api/`)
Expected: FAIL — `?batchId=` returns 2 rows (filter ignored) and `batch` is undefined.

- [ ] **Step 3: Add the `batchId` filter to `buildWhere`**

In `api/src/routes/invoices.ts`, inside `buildWhere` (after the `minTotal` line, ~line 20), add:

```ts
  if (q.batchId) where.batchId = q.batchId;
```

- [ ] **Step 4: Include the batch in the list and detail queries**

In the list query `include` block (`api/src/routes/invoices.ts:54-58`), add a `batch` select alongside `_count` and `runs`:

```ts
      include: {
        _count: { select: { lineItems: true } },
        // newest run carries the cost of the current extraction (ollama/local = 0)
        runs: { orderBy: { createdAt: 'desc' }, take: 1, select: { costEstimate: true, pageCount: true, provider: true } },
        batch: { select: { id: true, name: true } },
      },
```

(`batch` flows through the existing `...rest` spread in the `.map`, so no mapping change is needed.)

In the detail query `include` (`api/src/routes/invoices.ts:70-71`), add `batch`:

```ts
    const inv = await prisma.invoice.findUnique({ where: { id },
      include: { lineItems: { orderBy: { lineNumber: 'asc' } }, runs: { orderBy: { createdAt: 'desc' } }, batch: { select: { id: true, name: true } } } });
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/routes/list.test.ts` (in `api/`)
Expected: all tests PASS.

- [ ] **Step 6: Run the full API suite**

Run: `npm test` (in `api/`)
Expected: all API tests PASS.

- [ ] **Step 7: Commit**

```bash
git add api/src/routes/invoices.ts api/tests/routes/list.test.ts
git commit -m "feat(api): filter invoices by batchId and include batch name"
```

---

### Task 5: Web API client + types

**Files:**
- Modify: `web/src/types.ts`
- Modify: `web/src/api.ts`

- [ ] **Step 1: Add the `Batch` type and extend `Invoice`**

In `web/src/types.ts`, add the `Batch` interface (after `Invoice`, before `ProviderInfo`):

```ts
export interface Batch { id: string; name: string; createdAt: string; total: number; completed: number; failed: number; processing: number; }
```

And add two fields to the `Invoice` interface (after the `activeRunId` line, ~line 9):

```ts
  batchId?: string | null; batch?: { id: string; name: string } | null;
```

- [ ] **Step 2: Add `batches()` and extend `upload()` in the API client**

In `web/src/api.ts`, update the type import on line 1 to include `Batch`:

```ts
import type { Invoice, AppConfig, SettingsData, Analytics, ExtractionRun, Batch } from './types.js';
```

Add a `batches` method (after the `analytics` line, ~line 21):

```ts
  batches: () => j<{ batches: Batch[] }>('/api/batches'),
```

Replace the `upload` method (lines 27-32) with a version that accepts an optional batch name (appended first so it arrives before the files):

```ts
  upload: async (files: File[], batchName?: string) => {
    const fd = new FormData();
    if (batchName) fd.append('batchName', batchName);
    files.forEach((f) => fd.append('files', f));
    const res = await fetch('/api/invoices/upload', { method: 'POST', body: fd });
    if (!res.ok) throw new Error(`Upload failed: HTTP ${res.status}`);
    return res.json();
  },
```

- [ ] **Step 3: Type-check**

Run: `npm run build` (in `web/`)
Expected: `tsc --noEmit && vite build` succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/types.ts web/src/api.ts
git commit -m "feat(web): add Batch type, api.batches(), and upload batch name"
```

---

### Task 6: Invoices page — batch name input, dropdown filter, progress banner, row tag

**Files:**
- Modify: `web/src/pages/InvoicesPage.tsx`
- Test: `web/tests/InvoicesPage.test.tsx`

- [ ] **Step 1: Write the failing tests**

Replace `web/tests/InvoicesPage.test.tsx` with:

```tsx
import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InvoicesPage } from '../src/pages/InvoicesPage.js';
import { api } from '../src/api.js';

beforeEach(() => {
  vi.spyOn(api, 'list').mockResolvedValue({ invoices: [
    { id: '1', status: 'COMPLETED', vendorName: 'Acme', invoiceNumber: 'INV-1', invoiceDate: '2026-01-05', provider: 'azure', confidence: 0.9, itemCount: 3, totalAmount: 100, verified: false, batchId: 'b1', batch: { id: 'b1', name: 'April bills' } },
    { id: '2', status: 'COMPLETED', vendorName: 'Globex', invoiceNumber: 'INV-2', invoiceDate: '2026-02-05', provider: 'azure', confidence: 0.9, itemCount: 1, totalAmount: 50, verified: false, batchId: 'b2', batch: { id: 'b2', name: 'March recon' } },
  ] } as any);
  vi.spyOn(api, 'config').mockResolvedValue({ providers: [] } as any);
  vi.spyOn(api, 'batches').mockResolvedValue({ batches: [
    { id: 'b1', name: 'April bills', createdAt: '2026-04-01', total: 1, completed: 1, failed: 0, processing: 0 },
    { id: 'b2', name: 'March recon', createdAt: '2026-03-01', total: 1, completed: 1, failed: 0, processing: 0 },
  ] } as any);
});

it('renders rows from the API', async () => {
  render(<MemoryRouter><InvoicesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
  expect(screen.getByText('INV-1')).toBeTruthy();
});

it('filters the table to the selected batch', async () => {
  render(<MemoryRouter><InvoicesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
  // Both vendors visible before filtering.
  expect(screen.getByText('Globex')).toBeTruthy();
  // Select the "April bills" batch (b1) in the batch filter dropdown.
  fireEvent.change(screen.getByLabelText('Filter by batch'), { target: { value: 'b1' } });
  await waitFor(() => expect(screen.queryByText('Globex')).toBeNull());
  expect(screen.getByText('Acme')).toBeTruthy();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/InvoicesPage.test.tsx` (in `web/`)
Expected: the new "filters the table to the selected batch" test FAILS (no element labelled "Filter by batch"); the first test may also fail because `api.batches` is now called and must be wired.

- [ ] **Step 3: Add batch state and data fetching**

In `web/src/pages/InvoicesPage.tsx`:

(a) Update the type import on line 4:

```tsx
import type { Invoice, Batch } from '../types.js';
```

(b) Add state next to the other filter state (after the `dateTo` state, ~line 98):

```tsx
  const [batches, setBatches] = useState<Batch[]>([]);
  const [batchFilter, setBatchFilter] = useState('');
  const [batchName, setBatchName] = useState('');
```

(c) Fetch batches alongside invoices. Replace the `fetchAll` callback (lines 116-123) with:

```tsx
  const fetchAll = useCallback(async () => {
    try {
      const [inv, bat] = await Promise.all([api.list(''), api.batches().catch(() => ({ batches: [] }))]);
      setAllInvoices(inv.invoices);
      setBatches(bat.batches);
    } catch (_e) {
      // silently ignore for counts
    }
  }, []);
```

- [ ] **Step 4: Apply the batch filter client-side**

In the `displayedRows` IIFE, immediately after `let rows = applyClientFilters(allInvoices, statusFilter);` (line 169), add:

```tsx
    if (batchFilter) rows = rows.filter((inv) => inv.batchId === batchFilter);
```

- [ ] **Step 5: Add the batch dropdown filter to the header controls**

In the right-hand controls `div` (after the Search `input`, before the Filters toggle button — around line 422), insert:

```tsx
          {/* Batch filter */}
          <select
            aria-label="Filter by batch"
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            style={{
              padding: '7px 12px',
              border: `1px solid ${T.border}`,
              borderRadius: 7,
              fontSize: 13,
              fontFamily: T.font,
              color: T.text,
              background: T.rail,
              outline: 'none',
              maxWidth: 200,
            }}
          >
            <option value="">All batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
```

- [ ] **Step 6: Add the progress banner for the selected batch**

Directly after the status filter pill row block (after its closing `</div>`, ~line 716, before the Bulk action bar), insert:

```tsx
      {/* Batch progress banner */}
      {batchFilter && (() => {
        const b = batches.find((x) => x.id === batchFilter);
        if (!b) return null;
        const pct = b.total ? Math.round((b.completed / b.total) * 100) : 0;
        return (
          <div style={{ margin: '12px 30px 0', padding: '12px 16px', background: T.rail, border: `1px solid ${T.border}`, borderRadius: 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 8 }}>
              <span>{b.name}</span>
              <span style={{ color: T.muted, fontWeight: 500 }}>
                {b.completed}/{b.total} done{b.failed ? ` · ${b.failed} failed` : ''}{b.processing ? ` · ${b.processing} in progress` : ''}
              </span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: '#e8e3da', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: T.accent, transition: 'width 0.3s' }} />
            </div>
          </div>
        );
      })()}
```

- [ ] **Step 7: Add the per-row batch chip**

In the Vendor `<td>` (around lines 955-964), replace the file/address sub-line block with one that also shows the batch chip:

```tsx
                    {/* Vendor */}
                    <td style={tdBase}>
                      <div style={{ fontWeight: 600, color: T.text }}>
                        {row.vendorName ?? '—'}
                      </div>
                      {(row.fileName || row.vendorAddress) && (
                        <div style={{ fontSize: 11, color: T.faint, marginTop: 2 }}>
                          {row.fileName || row.vendorAddress}
                        </div>
                      )}
                      {row.batch && (
                        <span style={{ display: 'inline-block', marginTop: 4, padding: '1px 7px', background: T.accentSoft, color: T.accent, borderRadius: 5, fontSize: 10, fontWeight: 600 }}>
                          {row.batch.name}
                        </span>
                      )}
                    </td>
```

- [ ] **Step 8: Pass the batch name on upload, and add the input to the drop zone**

(a) Update `handleFiles` to pass the name and reset it (lines 297-317). Change the upload call and add a reset after success:

```tsx
      const result = await api.upload(pdfs, batchName.trim() || undefined);
```

and after `setShowUpload(false);` add:

```tsx
      setBatchName('');
```

(b) In the upload drop zone, just before the "Browse files" `<label>` (around line 635), add the batch-name input:

```tsx
          <input
            type="text"
            aria-label="Batch name"
            placeholder="Batch name (optional)"
            value={batchName}
            onChange={(e) => setBatchName(e.target.value)}
            style={{
              display: 'block',
              margin: '0 auto 14px',
              maxWidth: 280,
              width: '100%',
              padding: '8px 12px',
              border: `1px solid ${T.border}`,
              borderRadius: 7,
              fontSize: 13,
              fontFamily: T.font,
              color: T.text,
              background: T.rail,
              outline: 'none',
            }}
          />
```

- [ ] **Step 9: Run the page tests to verify they pass**

Run: `npx vitest run tests/InvoicesPage.test.tsx` (in `web/`)
Expected: both tests PASS.

- [ ] **Step 10: Run the full web suite + build**

Run: `npm test` then `npm run build` (in `web/`)
Expected: all web tests PASS; build succeeds with no type errors.

- [ ] **Step 11: Commit**

```bash
git add web/src/pages/InvoicesPage.tsx web/tests/InvoicesPage.test.tsx
git commit -m "feat(web): batch upload name, filter, progress banner, and row tag"
```

---

### Task 7: End-to-end verification

**Files:** none (manual verification)

- [ ] **Step 1: Rebuild and start the stack**

The api Docker image bakes in the Prisma client at build time, so the new model needs a rebuild.

Run: `docker compose up --build -d`
Expected: `db`, `api`, `web` come up; the api container runs `prisma migrate deploy` and applies `add_batches`.

- [ ] **Step 2: Verify the batches endpoint responds**

Run: `curl -s http://localhost:4000/api/batches`
Expected: `{"batches":[...]}` (HTTP 200) — an array (possibly empty).

- [ ] **Step 3: Drive the UI**

Open `http://localhost:8080`, click **Upload bills**, type a batch name (e.g. "Smoke test"), and upload two PDFs. Expected: both appear as new rows tagged "Smoke test"; the **Batch** dropdown lists "Smoke test"; selecting it filters to those two rows and shows the progress banner.

- [ ] **Step 4: Final commit (if any verification tweaks were needed)**

```bash
git add -A
git commit -m "chore: verify upload batches end-to-end"
```

---

## Self-review notes

- **Spec coverage:** data model (Task 1), upload creates/names/tags/cleans batch (Task 2), `GET /api/batches` roll-up (Task 3), `batchId` filter + batch name on list (Task 4), web types/client incl. `upload(batchName)` (Task 5), upload name input + dropdown filter + progress banner + row tag + live polling via `fetchAll` (Task 6). All spec sections map to a task.
- **Type consistency:** `Batch` shape `{id,name,createdAt,total,completed,failed,processing}` is identical in `api/src/routes/batches.ts`, `web/src/types.ts`, and the test mocks. `Invoice.batch` is `{id,name}` everywhere. `api.batches()` returns `{batches}`; the page reads `.batches`.
- **Polling:** the existing `usePolling(refetch, …)` already calls `refetch → fetchAll`, which now also refetches `api.batches()`, so the banner/roll-up stay live while invoices process — no separate poll needed.
- **Out of scope (per spec):** batch rename-after-upload, whole-batch delete, "No batch" filter option.
```
