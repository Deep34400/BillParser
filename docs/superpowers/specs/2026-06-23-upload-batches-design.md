# Design: Upload Batches

**Date:** 2026-06-23
**Status:** Approved (design); pending spec review
**Branch:** `feat/upload-batches`

## Problem

The app already supports multi-file upload: `POST /api/invoices/upload` accepts
many PDFs in one request, and each PDF independently becomes its own invoice row
and is queued for extraction on its own (`void runExtraction(inv.id)` per file).

What's missing is the ability to **identify each bulk batch separately** — to tell
which invoices were uploaded together, see that batch's overall processing
progress, give it a human name, and filter the ledger down to it.

> Terminology note: "each creates a new line item" in the original request means
> *each file becomes its own row in the invoice ledger* (a new `Invoice`), which
> is already the behavior — not a `LineItem` sub-row.

## Goal

Treat every upload request as a named **batch**. Surface batches on the existing
Invoices page as: a filter, a live progress banner, a per-row tag, and an optional
name set at upload time.

## Non-goals (YAGNI)

- Renaming a batch after upload.
- Deleting a whole batch as a unit (deleting individual invoices still works).
- A "No batch" filter for legacy invoices uploaded before this feature.

These are easy to add later if needed.

## Data model

New `Batch` model and a nullable link from `Invoice`:

```prisma
model Batch {
  id        String    @id @default(cuid())
  name      String                       // user-given, or auto "Upload Jun 23, 2:05 PM"
  createdAt DateTime  @default(now())
  invoices  Invoice[]
}

// Invoice gains:
batchId String?
batch   Batch?  @relation(fields: [batchId], references: [id], onDelete: SetNull)
@@index([batchId])
```

- `batchId` is **nullable** so existing invoices and single uploads remain valid;
  `onDelete: SetNull` so deleting a batch (not in scope now) would orphan rather
  than cascade-delete invoices.
- **Every upload request creates exactly one batch**, even a single file (a batch
  of 1). Uniform and directly satisfies "identify each batch separately."
- Requires a Prisma migration, auto-applied in Docker via `prisma migrate deploy`.

## Backend

### `POST /api/invoices/upload` (modified)

- Accept an **optional `batchName`** text field in the multipart form. Handle it
  regardless of whether it arrives before or after the file parts.
- Create the `Batch` row up front with a default timestamp name
  (e.g. `Upload Jun 23, 2:05 PM`). If a `batchName` field is seen, update the
  batch's name.
- Tag every created invoice with `batchId`.
- **Empty-batch cleanup:** if nothing was created (all files duplicates/rejected),
  delete the batch so the dropdown stays clean.
- Response gains `{ batchId, batch }` alongside the existing
  `{ created, duplicates, rejected }`.

Parsing sketch (preserves the existing streaming, one-file-at-a-time model):

```ts
const defaultName = `Upload ${formatBatchTimestamp(new Date())}`;
let batch = await prisma.batch.create({ data: { name: defaultName } });
for await (const part of req.parts()) {
  if (part.type === 'field' && part.fieldname === 'batchName' && part.value) {
    await prisma.batch.update({ where: { id: batch.id }, data: { name: String(part.value) } });
    continue;
  }
  if (part.type !== 'file') continue;
  // ...existing hash/dedup/store...
  const inv = await prisma.invoice.create({ data: { fileName, storedPath, fileHash, batchId: batch.id } });
  created.push(inv);
  void runExtraction(inv.id);
}
if (created.length === 0) await prisma.batch.delete({ where: { id: batch.id } });
```

### `GET /api/batches` (new)

Returns one row per batch with a status roll-up, newest first:

```ts
[{ id, name, createdAt, total, completed, failed, processing }]
```

- `completed` = invoices with status `COMPLETED`.
- `failed` = status `FAILED`.
- `processing` = status `PENDING` or `PROCESSING` (in-flight).
- Computed with a Prisma `groupBy` on `(batchId, status)`.

### `GET /api/invoices` (modified)

- Add a `batchId` query param to `buildWhere` (single line).
- Include `batch: { select: { id, name } }` so each invoice carries its batch
  name for the per-row tag. (`batchId` is already a column on the invoice.)

## Frontend (InvoicesPage)

- **Upload zone:** add an optional "Batch name" text input next to the drop area;
  passed to `api.upload(files, batchName)`.
- **Batch filter:** a "Batch ▾" dropdown beside the Status pills, populated from
  `GET /api/batches`. Selecting one adds `batchId` to the list query.
- **Progress banner:** when a batch is selected, show
  `name · 7/12 done · 1 failed` with a progress bar, sourced from the batches
  endpoint.
- **Per-row tag:** a small batch chip in each row (e.g. under the vendor/file
  cell) so the batch is visible even without filtering.
- **Polling:** also refetch `/api/batches` while any invoice is processing, so the
  banner and roll-up counts stay live (reuses the existing 3s `usePolling`).

### API client / types

- `api.ts`: `batches()` (new), `upload(files, batchName?)` (extended), list query
  string gains `batchId`.
- `types.ts`: new `Batch` type; `Invoice` gains `batchId?` and
  `batch?: { id: string; name: string }`.

## Testing

**API (Vitest + live Postgres):**
- Upload creates exactly one batch and tags all created invoices with its id.
- `batchName` field sets the batch name; absent → default timestamp name.
- All-duplicate / all-rejected upload leaves **no** empty batch behind.
- `GET /api/batches` returns correct `total/completed/failed/processing` counts.
- `GET /api/invoices?batchId=...` returns only that batch's invoices.

**Web (Vitest + jsdom):**
- Batch dropdown filters the table to the selected batch.
- Progress banner renders the selected batch's counts.

## Rollout / migration

- One Prisma migration adds `Batch` and `Invoice.batchId`. Backward-compatible:
  all existing invoices keep `batchId = null`.
- No data backfill required.
```
