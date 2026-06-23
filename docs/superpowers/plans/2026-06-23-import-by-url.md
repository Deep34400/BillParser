# Import by URL / File Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/invoices/import` so invoices can be added by https URL or sandboxed server file path (as one named batch), reusing the upload ingest path via a shared helper.

**Architecture:** Extract the per-file ingest logic + batch finalize from the upload handler into `api/src/extraction/ingest.ts`. Add `api/src/lib/fetchSource.ts` to resolve a source string (https fetch OR sandboxed local file read) to PDF bytes. The new import route resolves each source and ingests it; the upload route is refactored to use the same helper. Frontend gets a textarea + "Import" button in the upload panel.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL 16, Node 20 global `fetch`, Vitest (api + jsdom web), React 18.

**Spec:** `docs/superpowers/specs/2026-06-23-import-by-url-design.md`

**Conventions:**
- API tests use `buildApp()` + `app.inject()` against a live Postgres and mock `runExtraction` (see `api/tests/routes/upload.test.ts`). Tests run single-fork (`vitest.config.ts`).
- `IMPORT_DIR` is read **live** from `process.env` inside `resolveSource` (NOT cached in `env.ts`), so tests can set/unset it per-test without import-order issues.
- `rejected` / `duplicates` entries uniformly use a `fileName` key (carrying the filename for uploads, the source string for imports) so the response shape matches the existing upload contract.

---

### Task 1: Shared ingest helper + upload refactor

**Files:**
- Create: `api/src/extraction/ingest.ts`
- Modify: `api/src/routes/invoices.ts` (upload handler + imports)
- Safety net: `api/tests/routes/upload.test.ts` (must stay green, unchanged)

- [ ] **Step 1: Confirm the upload tests are green before refactoring**

Run: `cd api && npx vitest run tests/routes/upload.test.ts`
Expected: all PASS (this is the regression net for the refactor).

- [ ] **Step 2: Create the shared ingest module**

Create `api/src/extraction/ingest.ts`:

```ts
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { prisma } from '../db.js';
import { env } from '../env.js';
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
  void runExtraction(inv.id);
}

// Delete the batch when nothing was created; otherwise return the fresh batch row.
export async function finalizeBatch(batchId: string, createdCount: number) {
  if (createdCount === 0) { await prisma.batch.delete({ where: { id: batchId } }); return null; }
  return prisma.batch.findUnique({ where: { id: batchId } });
}
```

- [ ] **Step 3: Refactor the upload handler to use the helper**

In `api/src/routes/invoices.ts`, replace the upload handler body (the `app.post('/api/invoices/upload', ...)` block) with:

```ts
  app.post('/api/invoices/upload', async (req, reply) => {
    await mkdir(env.uploadDir, { recursive: true });
    const acc: IngestAcc = { created: [], duplicates: [], rejected: [] };
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
      await ingestPdf(buf, part.filename, batch.id, acc);
    }
    const finalBatch = await finalizeBatch(batch.id, acc.created.length);
    reply.code(201);
    return { ...acc, batchId: finalBatch?.id ?? null, batch: finalBatch };
  });
```

- [ ] **Step 4: Fix imports in `invoices.ts`**

The upload handler no longer uses `sha256`, `isPdf`, `writeFile`, or `join` directly (they moved to `ingest.ts`); `mkdir` is still used. Update the top-of-file imports:

- Remove `import { sha256 } from '../lib/hash.js';`
- Remove `import { isPdf } from '../lib/pdf.js';`
- Change `import { writeFile, mkdir } from 'node:fs/promises';` to `import { mkdir } from 'node:fs/promises';`
- Remove `import { join } from 'node:path';`
- Add `import { ingestPdf, finalizeBatch, type IngestAcc } from '../extraction/ingest.js';`

(Keep `prisma`, `env`, `runExtraction`, `requestCancel`, `splitCost`, `BATCH_SELECT` — all still used elsewhere in the file.)

- [ ] **Step 5: Verify upload tests still pass + the build is clean**

Run: `cd api && npx vitest run tests/routes/upload.test.ts && npm run build`
Expected: upload tests PASS; `tsc` build succeeds with no unused-import errors.

- [ ] **Step 6: Commit**

```bash
git add api/src/extraction/ingest.ts api/src/routes/invoices.ts
git commit -m "refactor(api): extract shared ingestPdf/finalizeBatch from upload"
```

---

### Task 2: `resolveSource` — fetch URL or read sandboxed file

**Files:**
- Create: `api/src/lib/fetchSource.ts`
- Test: `api/tests/lib/fetchSource.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/tests/lib/fetchSource.test.ts`:

```ts
import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSource } from '../../src/lib/fetchSource.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'imp-')); });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.IMPORT_DIR; rmSync(dir, { recursive: true, force: true }); });

function mockFetch(opts: { ok?: boolean; status?: number; bytes?: Buffer; contentLength?: string }) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? (opts.contentLength ?? null) : null) },
    arrayBuffer: async () => (opts.bytes ?? Buffer.from('%PDF-1.4')).buffer.slice(0),
  })));
}

it('fetches an https URL and derives the filename from the path', async () => {
  mockFetch({ bytes: Buffer.from('%PDF-1.4 hi') });
  const r = await resolveSource('https://example.com/files/inv-9.pdf?token=abc');
  expect(r.fileName).toBe('inv-9.pdf');
  expect(r.buf.toString()).toBe('%PDF-1.4 hi');
});

it('throws on a non-2xx http response', async () => {
  mockFetch({ ok: false, status: 404 });
  await expect(resolveSource('https://example.com/x.pdf')).rejects.toThrow('HTTP 404');
});

it('reads a local file inside IMPORT_DIR', async () => {
  process.env.IMPORT_DIR = dir;
  writeFileSync(join(dir, 'a.pdf'), '%PDF-1.4 local');
  const r = await resolveSource('a.pdf');
  expect(r.fileName).toBe('a.pdf');
  expect(r.buf.toString()).toBe('%PDF-1.4 local');
});

it('rejects a path that escapes IMPORT_DIR', async () => {
  process.env.IMPORT_DIR = dir;
  await expect(resolveSource('../secret.pdf')).rejects.toThrow('path outside IMPORT_DIR');
});

it('rejects local paths when IMPORT_DIR is unset', async () => {
  await expect(resolveSource('a.pdf')).rejects.toThrow('local file import not enabled');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run tests/lib/fetchSource.test.ts`
Expected: FAIL — module `fetchSource` does not exist.

- [ ] **Step 3: Implement `resolveSource`**

Create `api/src/lib/fetchSource.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { resolve, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_BYTES = 50 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

// Resolve a source string to PDF bytes + a derived filename.
// Throws Error(reason) on failure; the caller turns that into a `rejected` entry.
export async function resolveSource(source: string): Promise<{ buf: Buffer; fileName: string }> {
  const s = source.trim();
  if (/^https?:\/\//i.test(s)) return fetchUrl(s);
  const path = /^file:\/\//i.test(s) ? fileURLToPath(s) : s;
  return readLocal(path);
}

async function fetchUrl(url: string): Promise<{ buf: Buffer; fileName: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error('file too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('file too large');
  const name = new URL(url).pathname.split('/').filter(Boolean).pop() || 'download.pdf';
  return { buf, fileName: name };
}

async function readLocal(p: string): Promise<{ buf: Buffer; fileName: string }> {
  const importDir = (process.env.IMPORT_DIR ?? '').trim();
  if (!importDir) throw new Error('local file import not enabled (set IMPORT_DIR)');
  const base = resolve(importDir);
  const abs = resolve(base, p);
  if (abs !== base && !abs.startsWith(base + sep)) throw new Error('path outside IMPORT_DIR');
  const buf = await readFile(abs).catch(() => { throw new Error('file not found'); });
  return { buf, fileName: basename(abs) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npx vitest run tests/lib/fetchSource.test.ts`
Expected: all 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/fetchSource.ts api/tests/lib/fetchSource.test.ts
git commit -m "feat(api): add resolveSource (https fetch + sandboxed file read)"
```

---

### Task 3: `POST /api/invoices/import` endpoint

**Files:**
- Modify: `api/src/routes/invoices.ts`
- Test: `api/tests/routes/import.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/tests/routes/import.test.ts`:

```ts
import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { PDFDocument } from 'pdf-lib';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as run from '../../src/extraction/run.js';

async function pdfBytes(tag: string): Promise<Buffer> {
  const d = await PDFDocument.create();
  const p = d.addPage();
  p.drawText(tag);
  return Buffer.from(await d.save());
}

let dir: string;
beforeEach(async () => {
  await prisma.invoice.deleteMany();
  await prisma.batch.deleteMany();
  vi.spyOn(run, 'runExtraction').mockResolvedValue();
  dir = mkdtempSync(join(tmpdir(), 'imp-'));
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.IMPORT_DIR; rmSync(dir, { recursive: true, force: true }); });

function mockFetchReturning(buf: Buffer) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true, status: 200,
    headers: { get: () => null },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  })));
}

async function importReq(app: any, body: unknown) {
  return app.inject({ method: 'POST', url: '/api/invoices/import', payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

it('imports from an https URL into a named batch', async () => {
  mockFetchReturning(await pdfBytes('url-a'));
  const app = await buildApp();
  const r = await importReq(app, { sources: ['https://example.com/a.pdf'], batchName: 'From URLs' });
  const body = r.json();
  expect(r.statusCode).toBe(201);
  expect(body.created).toHaveLength(1);
  expect(body.batch.name).toBe('From URLs');
  expect(body.created[0].batchId).toBe(body.batchId);
  await app.close();
});

it('imports a local file inside IMPORT_DIR', async () => {
  process.env.IMPORT_DIR = dir;
  writeFileSync(join(dir, 'local.pdf'), await pdfBytes('file-a'));
  const app = await buildApp();
  const r = await importReq(app, { sources: ['local.pdf'] });
  expect(r.json().created).toHaveLength(1);
  await app.close();
});

it('rejects a non-PDF URL with a reason and creates no invoice', async () => {
  mockFetchReturning(Buffer.from('not a pdf'));
  const app = await buildApp();
  const r = await importReq(app, { sources: ['https://example.com/x.pdf'] });
  expect(r.json().created).toHaveLength(0);
  expect(r.json().rejected[0]).toMatchObject({ fileName: 'https://example.com/x.pdf', reason: 'not a PDF' });
  expect(await prisma.batch.count()).toBe(0); // empty batch cleaned up
  await app.close();
});

it('rejects a path that escapes IMPORT_DIR', async () => {
  process.env.IMPORT_DIR = dir;
  const app = await buildApp();
  const r = await importReq(app, { sources: ['../../etc/passwd.pdf'] });
  expect(r.json().rejected[0].reason).toMatch(/path outside IMPORT_DIR/);
  await app.close();
});

it('reports a duplicate when the hash already exists', async () => {
  const buf = await pdfBytes('dup');
  mockFetchReturning(buf);
  const app = await buildApp();
  await importReq(app, { sources: ['https://example.com/a.pdf'] }); // first import
  mockFetchReturning(buf); // same bytes again
  const r = await importReq(app, { sources: ['https://example.com/a.pdf'] });
  expect(r.json().created).toHaveLength(0);
  expect(r.json().duplicates).toHaveLength(1);
  await app.close();
});

it('returns 400 when sources is missing or empty', async () => {
  const app = await buildApp();
  expect((await importReq(app, {})).statusCode).toBe(400);
  expect((await importReq(app, { sources: [] })).statusCode).toBe(400);
  await app.close();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd api && npx vitest run tests/routes/import.test.ts`
Expected: FAIL — route returns 404 (not registered).

- [ ] **Step 3: Implement the import route**

In `api/src/routes/invoices.ts`, add the import for `resolveSource` at the top:

```ts
import { resolveSource } from '../lib/fetchSource.js';
```

Then add this handler inside `invoiceRoutes`, right after the `upload` handler:

```ts
  app.post('/api/invoices/import', async (req, reply) => {
    const { sources, batchName } = (req.body ?? {}) as { sources?: unknown; batchName?: string };
    if (!Array.isArray(sources) || sources.length === 0 || !sources.every((s) => typeof s === 'string')) {
      return reply.code(400).send({ error: 'sources must be a non-empty string array' });
    }
    await mkdir(env.uploadDir, { recursive: true });
    const acc: IngestAcc = { created: [], duplicates: [], rejected: [] };
    const defaultName = 'Import ' + new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    const batch = await prisma.batch.create({ data: { name: batchName?.trim() || defaultName } });
    for (const source of sources as string[]) {
      try {
        const { buf, fileName } = await resolveSource(source);
        await ingestPdf(buf, fileName, batch.id, acc, source);
      } catch (e) {
        acc.rejected.push({ fileName: source, reason: e instanceof Error ? e.message : 'failed' });
      }
    }
    const finalBatch = await finalizeBatch(batch.id, acc.created.length);
    reply.code(201);
    return { ...acc, batchId: finalBatch?.id ?? null, batch: finalBatch };
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd api && npx vitest run tests/routes/import.test.ts`
Expected: all 6 PASS.

- [ ] **Step 5: Run the full API suite**

Run: `cd api && npm test`
Expected: all API tests PASS (no regressions).

- [ ] **Step 6: Commit**

```bash
git add api/src/routes/invoices.ts api/tests/routes/import.test.ts
git commit -m "feat(api): add POST /api/invoices/import (URL + file path)"
```

---

### Task 4: Deployment config (IMPORT_DIR mount + gitignore)

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.gitignore`
- Create: `import/.gitkeep`

- [ ] **Step 1: Add the import mount + env to the api service**

In `docker-compose.yml`, in the `api` service `environment:` block, add a line:

```yaml
      IMPORT_DIR: /data/import
```

And in the `api` service `volumes:` list (currently `[ "uploads:/data/uploads" ]`), add the bind mount:

```yaml
    volumes: [ "uploads:/data/uploads", "./import:/data/import" ]
```

- [ ] **Step 2: Ignore dropped PDFs but keep the folder**

Append to `.gitignore`:

```
import/*
!import/.gitkeep
```

- [ ] **Step 3: Create the placeholder so the folder exists in the repo**

Create `import/.gitkeep` with a single comment line:

```
# Drop PDFs here to import them via /data/import in the app (see Settings/import).
```

- [ ] **Step 4: Verify compose config is valid**

Run: `docker compose config >/dev/null && echo OK`
Expected: `OK` (no YAML/compose errors).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .gitignore import/.gitkeep
git commit -m "chore: mount ./import as IMPORT_DIR for file-path import"
```

---

### Task 5: Web API client — `importSources`

**Files:**
- Modify: `web/src/api.ts`

- [ ] **Step 1: Add the `importSources` method**

In `web/src/api.ts`, add this method to the `api` object, right after the existing `upload` method:

```ts
  importSources: async (sources: string[], batchName?: string) => {
    const res = await fetch('/api/invoices/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sources, batchName }),
    });
    if (!res.ok) throw new Error(`Import failed: HTTP ${res.status}`);
    return res.json();
  },
```

- [ ] **Step 2: Type-check / build**

Run: `cd web && npm run build`
Expected: `tsc --noEmit && vite build` succeeds with no type errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/api.ts
git commit -m "feat(web): add api.importSources"
```

---

### Task 6: Web UI — import textarea + button

**Files:**
- Modify: `web/src/pages/InvoicesPage.tsx`
- Test: `web/tests/InvoicesPage.test.tsx`

- [ ] **Step 1: Write the failing test**

Append this test to `web/tests/InvoicesPage.test.tsx` (keep the existing tests + `beforeEach`):

```tsx
it('imports pasted URLs/paths via the Import button', async () => {
  const spy = vi.spyOn(api, 'importSources').mockResolvedValue({ created: [{}], duplicates: [], rejected: [] } as any);
  render(<MemoryRouter><InvoicesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Upload bills' }));
  fireEvent.change(screen.getByLabelText('Import URLs or paths'), {
    target: { value: 'https://x.com/a.pdf\n\n/data/import/b.pdf\n' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith(['https://x.com/a.pdf', '/data/import/b.pdf'], undefined));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run tests/InvoicesPage.test.tsx`
Expected: the new test FAILS (no "Import URLs or paths" element).

- [ ] **Step 3: Add import state**

In `web/src/pages/InvoicesPage.tsx`, add state next to `batchName` (after the `const [batchName, setBatchName] = useState('');` line):

```tsx
  const [importText, setImportText] = useState('');
```

- [ ] **Step 4: Add the `handleImport` function**

Add this function right after the `handleFiles` function (after its closing brace):

```tsx
  // Import handler — paste URLs / server file paths, one per line.
  async function handleImport() {
    const sources = importText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (sources.length === 0) {
      setToast('Paste at least one URL or file path');
      return;
    }
    try {
      const result = await api.importSources(sources, batchName.trim() || undefined);
      const created = result?.created?.length ?? 0;
      const dupes = result?.duplicates?.length ?? 0;
      const rejected = result?.rejected?.length ?? 0;
      if (dupes > 0) setDuplicateBanner({ count: dupes });
      await refetch();
      setToast(
        `Imported ${created} file${created === 1 ? '' : 's'}${dupes ? `, ${dupes} duplicate${dupes === 1 ? '' : 's'} skipped` : ''}${rejected ? `, ${rejected} rejected` : ''}`,
      );
      setShowUpload(false);
      setImportText('');
      setBatchName('');
    } catch (e) {
      setToast('Import failed: ' + (e instanceof Error ? e.message : 'unknown'));
    }
  }
```

- [ ] **Step 5: Add the textarea + Import button to the upload panel**

In the upload drop zone block (`{showUpload && (...)}`), after the "Browse files" `<label>...</label>` element and before the closing `</div>` of the drop zone, insert:

```tsx
          <div style={{ marginTop: 18, borderTop: `1px solid ${T.border}`, paddingTop: 16 }}>
            <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>
              …or paste URLs / server file paths, one per line
            </div>
            <textarea
              aria-label="Import URLs or paths"
              placeholder={'https://bucket.s3.amazonaws.com/invoice.pdf\n/data/import/invoice.pdf'}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={3}
              style={{ width: '100%', maxWidth: 480, padding: '8px 12px', border: `1px solid ${T.border}`, borderRadius: 7, fontSize: 12, fontFamily: T.mono, color: T.text, background: T.rail, outline: 'none', resize: 'vertical' }}
            />
            <div>
              <button
                onClick={() => void handleImport()}
                style={{ marginTop: 10, padding: '8px 20px', background: T.accent, color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}
              >
                Import
              </button>
            </div>
          </div>
```

- [ ] **Step 6: Run the page tests to verify they pass**

Run: `cd web && npx vitest run tests/InvoicesPage.test.tsx`
Expected: all tests (existing + new import test) PASS.

- [ ] **Step 7: Run the full web suite + build**

Run: `cd web && npm test && npm run build`
Expected: all web tests PASS; build succeeds.

- [ ] **Step 8: Commit**

```bash
git add web/src/pages/InvoicesPage.tsx web/tests/InvoicesPage.test.tsx
git commit -m "feat(web): import URLs/paths from the upload panel"
```

---

### Task 7: End-to-end verification

**Files:** none (manual)

- [ ] **Step 1: Rebuild and start the stack**

Run: `docker compose up --build -d`
Expected: `db`, `api`, `web` come up; the `./import` bind mount is created.

- [ ] **Step 2: Verify the import endpoint validates input**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4000/api/invoices/import -H 'content-type: application/json' -d '{}'`
Expected: `400` (sources required).

- [ ] **Step 3: Import a local file via the mount**

Copy any PDF into the repo's `import/` folder as `import/smoke.pdf`, then:

Run: `curl -s -X POST http://localhost:4000/api/invoices/import -H 'content-type: application/json' -d '{"sources":["smoke.pdf"],"batchName":"Smoke import"}'`
Expected: JSON with `created` length 1 and `batch.name` = "Smoke import". Confirm it appears in the ledger: `curl -s http://localhost:4000/api/batches` shows the "Smoke import" batch.

- [ ] **Step 4: Drive the UI**

Open `http://localhost:8080`, click **Upload bills**, paste an https PDF URL (and/or `/data/import/smoke.pdf`) into the "…paste URLs / server file paths" textarea, optionally set a batch name, and click **Import**. Expected: a toast reports the imported count and the rows appear, tagged with the batch; selecting the batch shows the progress banner.

- [ ] **Step 5: Final commit (if any verification tweaks were needed)**

```bash
git add -A
git commit -m "chore: verify import-by-url end-to-end"
```

---

## Self-review notes

- **Spec coverage:** shared ingest + upload refactor (Task 1); `resolveSource` https fetch + sandboxed file read with all reason strings (Task 2); `POST /api/invoices/import` incl. validation, batch, dedup, rejected, empty cleanup (Task 3); `IMPORT_DIR` mount + gitignore (Task 4); web client `importSources` (Task 5); textarea + Import button + handler (Task 6); E2E (Task 7). All spec sections map to a task.
- **Testability decision:** `resolveSource` reads `process.env.IMPORT_DIR` live (not `env.ts`) so per-test temp dirs work under vitest's single-fork model. Documented at top.
- **Type/shape consistency:** `IngestAcc` `{ created, duplicates, rejected }` is defined in `ingest.ts` and used by both upload and import; response is `{ ...acc, batchId, batch }` in both (matches existing upload contract). `rejected`/`duplicates` entries use the `fileName` key everywhere. `resolveSource` returns `{ buf, fileName }` in both branches.
- **Out of scope (per spec):** `s3://` scheme / AWS SDK, directory globbing, SSRF internal-IP blocking.
```
