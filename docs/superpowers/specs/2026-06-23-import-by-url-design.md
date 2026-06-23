# Design: Import invoices by URL / server file path

**Date:** 2026-06-23
**Status:** Approved (design); pending spec review
**Branch:** `feat/import-by-url`

## Problem

Invoices can only be added by uploading PDF files through the browser
(`POST /api/invoices/upload`, multipart). We want to also add invoices by
reference — pointing the server at PDFs that already live somewhere — without
re-uploading the bytes from the browser.

Two source kinds are in scope (decided during brainstorming):

1. **Server file paths** — a PDF on the API server's mounted volume (no network
   fetch).
2. **https URLs** — fetched by the server over http(s). This naturally covers S3
   presigned/public links, so no AWS SDK or credentials are needed.

Both kinds: multiple per submit, landing as **one named batch** (reusing the
batch feature already built).

## Goal

A `POST /api/invoices/import` endpoint that accepts a list of source strings
(URLs and/or file paths) plus an optional batch name, resolves each to PDF bytes,
and ingests them exactly like uploaded files (PDF validation, SHA-256 dedup,
store, create invoice tagged with the batch, queue extraction). A textarea + an
"Import" button on the Invoices page drive it.

## Non-goals (YAGNI)

- `s3://` scheme support / AWS SDK / S3 credentials (https S3 links cover the need).
- Fetching non-PDF content or converting other formats.
- Recursive directory import / globbing of server paths (one explicit path per line).
- Internal-IP/SSRF blocklists (single-tenant self-hosted; noted as a consideration).

## Approach

A new JSON endpoint rather than overloading the multipart upload. The core
"bytes → invoice" logic and the batch lifecycle are extracted into a shared
module so upload and import behave identically (the upload handler has grown
since the batches work; this is a natural DRY-up).

```
POST /api/invoices/import
  body: { sources: string[], batchName?: string }
  → for each source:
      resolveSource(source) -> { buf, fileName }      (fetch OR read file)
      ingestPdf(buf, fileName, batchId, acc)           (shared with upload)
  → finalizeBatch(batchId, created.length)
  → 201 { created, duplicates, rejected, batchId, batch }   (same shape as upload)
```

## Backend units

### `api/src/extraction/ingest.ts` (new) — shared ingestion

```ts
type IngestAcc = { created: any[]; duplicates: any[]; rejected: any[] };

// PDF-validate -> hash -> dedup -> store -> create invoice (tagged) -> queue extraction.
// `label` is the human-facing identifier used in duplicates/rejected entries
// (the original filename for uploads, the source string for imports).
async function ingestPdf(buf: Buffer, fileName: string, batchId: string, acc: IngestAcc, label?: string): Promise<void>;

// Delete the batch if nothing was created; return the fresh batch row (or null).
async function finalizeBatch(batchId: string, createdCount: number): Promise<Batch | null>;
```

`ingestPdf` is the current inline upload body (lines 42-51 of `invoices.ts`),
moved verbatim in behavior. It uses `const entryName = label ?? fileName` as the
entry identifier: `isPdf` → `rejected.push({ fileName: entryName, reason: 'not a PDF' })`;
`sha256` + `findUnique` → `duplicates.push({ fileName: entryName, id: existing.id })`;
else `writeFile` to `${uploadDir}/${hash}.pdf`,
`prisma.invoice.create({ ..., batchId })`, `void runExtraction(inv.id)`,
`created.push(inv)`. (Upload passes no `label`, so `id` is the filename — its
existing response shape is unchanged.)

### `api/src/lib/fetchSource.ts` (new) — source resolution

```ts
// Resolve a source string to PDF bytes + a derived filename.
// Throws Error(reason) on failure; the caller turns that into a `rejected` entry.
async function resolveSource(source: string): Promise<{ buf: Buffer; fileName: string }>;
```

- **https?:// URL** → `fetch` with a 30s `AbortSignal.timeout`, only `http`/`https`
  schemes, stream into a buffer with a **50 MB cap** (abort if exceeded), reject
  on non-2xx. `fileName` = last non-empty path segment of the URL (fallback
  `download.pdf`).
- **`file://` URL** → normalized to a filesystem path, then treated as below.
- **Local file path** → resolved against `env.importDir` (the sandbox). The
  resolved absolute path MUST be inside `importDir`; otherwise throw
  `"path outside IMPORT_DIR"`. If `importDir` is empty/unset, throw
  `"local file import not enabled (set IMPORT_DIR)"`. Read the file; `fileName` =
  basename. Path-magic check happens later in `ingestPdf`.

Sandbox check: `const abs = path.resolve(importDir, source); if (!abs.startsWith(path.resolve(importDir) + path.sep)) throw ...`.

### `api/src/env.ts` — config

Add `importDir: process.env.IMPORT_DIR ?? ''` (empty = local file import disabled by default).

### `api/src/routes/invoices.ts` — the endpoint + refactor

- Refactor `POST /api/invoices/upload` to call `ingestPdf` per file part and
  `finalizeBatch` at the end (batch create/name logic unchanged).
- Add `POST /api/invoices/import`:
  ```ts
  const { sources, batchName } = req.body as { sources?: string[]; batchName?: string };
  // validate sources is a non-empty string[]
  const batch = await prisma.batch.create({ data: { name: batchName || defaultName } });
  for (const source of sources) {
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
  ```

## Security

- **Local paths are sandboxed** to `IMPORT_DIR`; paths resolving outside it (or
  when unset) are rejected. Prevents path traversal to arbitrary server files.
- **https fetch**: scheme allowlist (`http`/`https`), 50 MB cap, 30s timeout, and
  the same PDF-magic validation as uploads. SSRF to internal hosts is not blocked
  by default (single-tenant self-hosted, intranet links may be desired) — noted.
- The response never leaks file contents; `rejected` reasons are short strings.

## Deployment

Add to `docker-compose.yml` (api service) so file-path import works out of the box:
- env `IMPORT_DIR=/data/import`
- a bind mount `./import:/data/import` (drop PDFs into the repo's `import/` folder
  and reference them as `/data/import/foo.pdf` or just `foo.pdf`).

`.gitignore`: add `import/` (don't commit dropped PDFs). Keep the folder with a
`.gitkeep`.

## Frontend

### `web/src/api.ts`
```ts
importSources: (sources: string[], batchName?: string) =>
  j<UploadResult>('/api/invoices/import', { method: 'POST', body: JSON.stringify({ sources, batchName }) }),
```
(`UploadResult` is the existing untyped upload response shape: `{ created, duplicates, rejected, batchId, batch }`.)

### `web/src/pages/InvoicesPage.tsx`
In the upload panel, below the drop zone and sharing the batch-name input, add:
- a **textarea** `aria-label="Import URLs or paths"`, placeholder
  "…or paste URLs / server file paths, one per line".
- an **"Import" button** that splits the textarea on newlines, trims, drops empty
  lines, and calls `api.importSources(lines, batchName.trim() || undefined)`.
- Success path reuses the existing upload result handling: duplicate banner,
  refetch, toast `Imported N file(s)…`, reset the textarea + batch name, close the
  panel. Errors → toast. A non-empty `rejected` count is surfaced in the toast.

## Testing

**API (Vitest + live Postgres; mock global `fetch`; temp `IMPORT_DIR`):**
- Import from an https URL (mocked `fetch` returns a PDF buffer) → 1 created,
  tagged with the batch.
- Import a local file placed inside the temp `IMPORT_DIR` → created.
- Non-PDF content (URL or file) → `rejected` with reason "not a PDF".
- Duplicate (hash already in DB) → `duplicates`.
- Path outside `IMPORT_DIR` (e.g. `../secret.pdf`) → `rejected` "path outside IMPORT_DIR".
- Local path when `IMPORT_DIR` unset → `rejected` "local file import not enabled…".
- All-rejected import → no empty batch left (`finalizeBatch` cleanup).
- Refactored upload endpoint: existing `upload.test.ts` still passes unchanged.

**Web (Vitest + jsdom):**
- Typing two lines into the import textarea and clicking "Import" calls
  `api.importSources` with `['<line1>', '<line2>']` and the batch name.

## Rollout

- No schema migration (reuses `Batch` + `Invoice.batchId`).
- New env var `IMPORT_DIR` (optional; empty disables file-path import). Backward
  compatible — existing upload flow unchanged in behavior.
```
