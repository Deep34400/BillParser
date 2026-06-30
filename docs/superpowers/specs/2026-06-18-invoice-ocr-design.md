# Invoice OCR — Design Spec

**Date:** 2026-06-18
**Status:** Approved (design phase)
**Source inputs:** `doc/PRD.html` (PRD v1.0), Claude Design prototype `Invoice OCR.dc.html` (Direction A — "Ledger")

A self-hosted tool that turns finance bill PDFs into structured, queryable data. Upload PDFs → a provider-agnostic extraction engine reads each one → results normalize into one canonical schema, persist to Postgres, and surface as a searchable table with full line-item detail, analytics, re-extraction, and live provider bake-offs.

---

## 1. Scope

### In scope (v1)
- Multi-file PDF upload (drag-drop / picker), ≤50 files, PDF-only, ≤50 MB each.
- Content-hash (SHA-256) de-duplication; duplicate uploads flagged + skipped (idempotent).
- Asynchronous extraction with live status: `PENDING → PROCESSING → COMPLETED | FAILED`. One slow/failed file never blocks others.
- Canonical extraction schema across all providers (header fields + line items + confidence).
- Provider abstraction: Mistral, Azure, LlamaParse (built); Textract, Google (stubbed → explicit FAILED).
- Markdown providers (Mistral, LlamaParse) run a second structuring LLM pass; structuring provider/model is configurable.
- Searchable, sortable, filterable invoice table (status, vendor, invoice #, date, provider, confidence, items, total).
- Invoice detail: all canonical fields, line items, provider + confidence badges, captured errors, expandable raw OCR.
- Re-extract / switch provider per invoice; line items replaced atomically.
- **Design extras (in scope):** Analytics dashboard, live provider bake-off, inline field edit + verify, bulk actions (re-extract / delete / export), header CSV export, line-item CSV export.
- **Settings page:** runtime, DB-backed provider configuration — manage credentials per provider, select active extraction provider and structuring provider/model.
- Delete invoice (line items cascade).
- Fully self-hosted via `docker compose up` (db + api + web).

### Out of scope (v1)
- Authentication / roles (PRD v1 is no-auth, trusted internal deployment). On roadmap.
- Durable job queue (BullMQ/Redis) + dedicated worker — extraction is in-process fire-and-forget for v1.
- Approval workflows, payments, ERP posting, email-inbox ingestion, mobile-native app, custom model training.
- The prototype's demo harness (PROTOTYPE badge, Simulate/Empty/Reset buttons, A/B direction toggle) — scaffolding only, dropped.

---

## 2. Tech stack
- **Frontend:** React + Vite + React Router, TypeScript. Direction A styling: indigo `#4f46e5`, cream `#f7f5f1`, panels `#fff`/`#fbfaf7`, borders `#e7e2d9`, Hanken Grotesk (UI) + Geist Mono (numeric/raw text).
- **API:** Node + Fastify + Prisma, TypeScript.
- **DB:** Postgres 16.
- **Packaging:** Docker Compose — `db`, `api`, `web`. Migrations auto-apply on API start. Uploads on a mounted volume.

---

## 3. Architecture

```
┌──────────┐  upload   ┌──────────────┐  extract   ┌────────────────────┐
│  React   │ ────────▶ │  Fastify API │ ─────────▶ │ Provider adapter   │
│  (Vite)  │ ◀──────── │  + Prisma    │ ◀───────── │ (Mistral/Azure/…)  │
└──────────┘   JSON    └──────┬───────┘ canonical   └─────────┬──────────┘
                              │                                │ OCR / structuring
                        ┌─────▼─────┐                   ┌──────▼───────┐
                        │ Postgres  │ invoices+items+   │ external API │
                        │           │ runs+config       └──────────────┘
                        └───────────┘
```

**Extraction execution:** in-process fire-and-forget. On upload, each new Invoice row is created `PENDING`; `runExtraction(invoiceId)` is invoked without awaiting, moves it to `PROCESSING`, calls the active provider, and writes `COMPLETED` (with canonical data) or `FAILED` (with a captured error). Failures are isolated per invoice.

**Bake-off + history persistence:** every extraction attempt (initial, re-extract, or a bake-off engine run) is stored as an `ExtractionRun`. The `Invoice` holds the **currently-applied** canonical fields + `LineItem`s (denormalized for fast table/search). Applying a bake-off winner copies that run's snapshot into the Invoice and replaces its line items in one transaction.

---

## 4. Data model (Prisma / Postgres 16)

### Invoice (one per bill)
- `id` cuid PK
- File/dedupe: `fileName`, `storedPath`, `fileHash` (unique)
- `status` enum: `PENDING | PROCESSING | COMPLETED | FAILED`
- Extraction meta: `provider`, `confidence` (Float?), `error` (String?)
- Vendor: `vendorName`, `vendorAddress`, `vendorTaxId`
- References: `invoiceNumber`, `poNumber`
- Dates: `invoiceDate`, `dueDate`
- Money: `currency`, `subtotal`, `taxAmount`, `totalAmount`
- `paymentTerms`
- Audit: `rawText`, `rawJson` (Json)
- Extras: `verified Boolean @default(false)`, `editedAt DateTime?`, `activeRunId String?`
- `createdAt`, `updatedAt`
- Indexes: `status`, `vendorName`, `invoiceDate`; unique `fileHash`.

### LineItem (many per invoice — the applied items)
- `id` cuid PK, `invoiceId` FK → Invoice (onDelete: Cascade)
- `lineNumber`, `description`, `sku`, `quantity`, `unitPrice`, `amount`, `taxRate`

### ExtractionRun (bake-off / re-extract history)
- `id` cuid PK, `invoiceId` FK → Invoice (cascade)
- `provider`, `structuringModel` (String?), `status` (`COMPLETED | FAILED`)
- `confidence`, `costEstimate`, `latencyMs`, `pageCount`
- `rawText`, `rawJson` (Json), `error` (String?)
- `fieldsSnapshot` (Json — canonical header fields), `itemsSnapshot` (Json — line items)
- `createdAt`
- Index: `invoiceId`.

### ProviderConfig (per-provider credentials)
- `provider` String PK
- `credentialsEnc` String (AES-256-GCM encrypted JSON blob: e.g. `{apiKey}`, Azure `{endpoint, apiKey}`, Textract `{accessKeyId, secretAccessKey, region}`, Google `{projectId, location, processorId, keyJson}`)
- `enabled Boolean @default(true)`, `updatedAt`
- Never returned raw; API exposes only `configured` + masked hints (last 4).

### Setting (KV for selections)
- `key` String PK, `value` String, `updatedAt`
- Keys: `extraction_provider`, `structuring_provider`, `structuring_model`.

---

## 5. Provider abstraction (`api/src/providers`)

```ts
type ProviderKind = 'markdown' | 'structured';

interface CanonicalResult {
  vendorName?, vendorAddress?, vendorTaxId?;
  invoiceNumber?, poNumber?;
  invoiceDate?, dueDate?;
  currency?, subtotal?, taxAmount?, totalAmount?, paymentTerms?;
  lineItems: { lineNumber, description?, sku?, quantity?, unitPrice?, amount?, taxRate? }[];
  confidence?: number;        // 0..1
  rawText: string;
  rawJson: unknown;
  costEstimate?: number;      // per this doc, derived from pageCount × rate
  latencyMs?: number;
  pageCount?: number;
}

interface ExtractionProvider {
  name: string;                       // 'mistral' | 'azure' | ...
  displayName: string;
  kind: ProviderKind;
  requiredCredentials: string[];      // field names expected in ProviderConfig
  isConfigured(creds: Record<string,string> | null): boolean;
  extract(file: Buffer, ctx: ExtractCtx): Promise<CanonicalResult>;
}
```

- **Registry** registers all providers; `/api/config` reports each with `configured` status. The active extraction provider comes from `Setting.extraction_provider` (env seeds default).
- **Markdown providers** (`mistral`, `llamaparse`): OCR → markdown, then call the **structuring service** with the selected structuring provider/model to map markdown → canonical fields + emit a confidence.
- **Structured providers** (`azure`, `textract`, `google`): map the provider's native invoice response directly to canonical (no LLM pass). Azure/Textract supply field-level confidences → averaged.
- **Stubs** (`textract`, `google`): registered but `extract()` throws a clear "provider not yet implemented" error → invoice `FAILED` with that message.
- **Structuring service** (`api/src/structuring`): adapters for Anthropic (Claude), OpenAI, Mistral; selected via `Setting.structuring_provider` + `structuring_model`.
- **No configured key →** `extract()` short-circuits to a `FAILED` with an explicit "no credentials configured for <provider>" error (no mock fallback).
- Adding a provider = implement the interface + register; it appears in UI + bake-off automatically.

**Cost/latency/confidence:** `latencyMs` measured around the call. `costEstimate` = `pageCount × referenceRatePer1k/1000` using a static per-provider reference table (PRD figures; shown as representative). Confidence from provider field-confidences where available, else structuring-model-emitted confidence blended with a completeness heuristic (share of expected header fields + presence of line items).

---

## 6. API (Fastify)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/config` | Active + available providers, `configured` per provider, current selections, structuring options |
| POST | `/api/invoices/upload` | Multipart, field `files`, 1..50 PDFs. Hash, dedupe, store, create PENDING rows, fire extraction. Returns created + `duplicates[]` |
| GET | `/api/invoices` | List/search. Query: `status, q, minTotal, dateFrom, dateTo, sort, dir` |
| GET | `/api/invoices/:id` | One invoice + line items + run summaries |
| POST | `/api/invoices/:id/reextract` | Re-run on stored file, optional `{provider}`; replaces items atomically |
| POST | `/api/invoices/:id/bakeoff` | Live — run stored file through every **configured** provider, persist an ExtractionRun each, return comparison |
| POST | `/api/invoices/:id/apply-run` | `{runId}` — apply a run's snapshot as the canonical result |
| PATCH | `/api/invoices/:id` | Inline edit of header/line-item fields → sets `verified=true`, `editedAt` |
| DELETE | `/api/invoices/:id` | Delete (line items + runs cascade) |
| POST | `/api/invoices/bulk` | `{action: 'reextract'|'delete', ids: []}` |
| GET | `/api/invoices/export/csv` | Header CSV, respects list filters |
| GET | `/api/invoices/export/line-items.csv` | Line-item CSV, respects list filters |
| GET | `/api/analytics` | Total spend, completed count, avg confidence, needs-review count, by-vendor, by-month |
| GET | `/api/settings` | Selections + per-provider `configured`/masked status |
| PUT | `/api/settings` | Update selections (extraction provider, structuring provider/model) |
| PUT | `/api/settings/providers/:provider` | Set/update credentials (encrypted) |
| DELETE | `/api/settings/providers/:provider` | Clear credentials |

Validation: reject non-PDF and >50 MB at upload; "needs review" = COMPLETED with `confidence` below a configurable threshold (default 0.75) or unverified low-confidence.

---

## 7. Frontend (React + Vite + React Router)

Direction A — "Ledger". Sidebar app shell: brand, nav (**Invoices**, **Analytics**, **Settings**), and on Invoices a status-filter list with counts.

- **`/invoices` (list):** header (count, search, Filters toggle, Export CSV, Items CSV, Upload bills); collapsible advanced filters (min total, issued from/to); duplicate-skipped banner; upload drop zone (real files, PDF-only, ≤50, ≤50 MB); bulk action bar when rows selected (Re-extract / Export / Delete / Clear); sortable + selectable table (Status dot+label, Vendor primary/secondary, Invoice #, Date, Provider chip, Confidence bar / ✓ Verified, Items, Total) with a responsive card layout for narrow widths; skeleton / empty / no-results states. Polls `GET /api/invoices` while any row is PENDING/PROCESSING.
- **`/invoices/:id` (detail):** back link; header card (status dot, verified badge, vendor, address, tax id, filename); provider re-extract `<select>` + Re-extract, **Compare source**, **Bake-off**, **Edit fields**, **Delete**; failed-error box; 4-col canonical field grid (Invoice #, PO #, invoice date, due date, currency, provider, confidence, totals); line-item table; subtotal/tax/total; expandable raw OCR. **Edit fields** swaps the field grid + items into inputs → **Save & verify** (`PATCH`) → marks verified.
- **Compare overlay:** split view — reconstructed source-document render (left) ⇄ raw OCR output (right).
- **Bake-off overlay:** one card per configured provider (confidence, header/line-item accuracy bars, items, total read, Δ vs source, cost/1k, latency, pattern) + "Use this engine" → `apply-run`.
- **`/analytics`:** 4 KPI cards (Total spend, Completed, Avg confidence, Needs review) + Top vendors by spend (bars) + Spend by month (bars).
- **`/settings`:** per-provider credential forms (fields per `requiredCredentials`, masked when set, Save/Clear, `configured` badge) + active extraction provider selector + structuring provider/model selectors.

CSV export triggers an authenticated browser download from the API with current filters applied.

---

## 8. Cross-cutting

- **Dedupe:** SHA-256 of file content; unique `fileHash`. Duplicate upload returns the existing invoice flagged, not re-processed.
- **Encryption:** AES-256-GCM, key derived from `APP_SECRET` (required env). Credentials encrypted at rest; API responses mask to `configured` + last 4. Missing `APP_SECRET` is a hard startup error.
- **Async isolation:** a throw inside one `runExtraction` is caught, recorded on that invoice, and never affects others.
- **Logging:** structured Fastify logs; per-invoice status/provider/confidence/raw payloads retained for audit.
- **Config precedence:** env vars seed `Setting` + `ProviderConfig` on first boot only; thereafter DB values (edited in Settings) win.

### Environment variables
- `DATABASE_URL`, `APP_SECRET` (required), `UPLOAD_DIR`
- Seeds (optional): `EXTRACTION_PROVIDER`, `STRUCTURING_MODEL_PROVIDER`, `STRUCTURING_MODEL`, `MISTRAL_API_KEY`, `AZURE_DI_ENDPOINT`, `AZURE_DI_KEY`, `LLAMAPARSE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, plus AWS/Google creds for stubs.
- Frontend: `VITE_API_BASE`.

---

## 9. Testing
- **API (Vitest):** provider response → canonical mappers (Azure/Textract/markdown structuring), dedupe hashing, CSV serialization (headers + line items), AES-GCM encrypt/decrypt round-trip + masking, confidence/cost derivation, route integration against a disposable test Postgres (upload→extract→list→detail→reextract→apply-run→delete). Real data, no mocking the unit under test; external provider HTTP is the only boundary stubbed.
- **Frontend:** component/logic tests for table sort/filter/select, polling stop condition, edit-form state, CSV trigger. Optional Playwright smoke for the upload→table→detail happy path.

---

## 10. Docker Compose
- `db`: `postgres:16`, named volume.
- `api`: Node build; on start runs `prisma migrate deploy` then serves Fastify; mounts uploads volume; reads env.
- `web`: builds the Vite app and serves static output; proxies `/api` to `api`.
- One `docker compose up` brings up the whole stack.

---

## 11. Success metrics (from PRD)
≥95% bills reach COMPLETED without manual fix · ≥90% header-field accuracy · ≥85% line-item accuracy (chosen provider) · →0 manual re-keying. Secondary: batch time-to-process, % low-confidence flagged, cost/1k pages, failure rate by provider.

---

## 12. Open questions (deferred, not blocking v1)
- Standing default provider after a cost/accuracy bake-off (operational, not code).
- Retention policy for raw OCR text + source PDFs.
- Auth model when it lands (SSO vs basic) — currently no-auth by decision.
