# OCR Module

Extracts structured invoice data from uploaded PDF/image files using LLM-based OCR.
This is the core module — everything else (analytics, fraud, vendor) depends on its output.

End-to-end flow diagram: [FLOW.md](./FLOW.md).

## Folder Structure

```
ocr/
├── models/
│   ├── bill.ts                   # Bill Sequelize model + initBillModel()
│   ├── billPart.ts               # BillPart Sequelize model + initBillPartModel()
│   ├── invoiceComment.ts         # InvoiceComment model (invoice_comments table)
│   └── index.ts                  # Barrel re-export
├── process.ts                    # Pipeline entry point — reads settings, builds fallback chain
├── pipeline/
│   ├── single.ts                 # Single OCR mode orchestration
│   ├── split.ts                  # Split OCR mode orchestration
│   └── fallbackChain.ts          # Multi-level fallback orchestration
├── providers/
│   ├── geminiClient.ts           # Gemini via Vertex AI — ADC auth, global endpoint
│   ├── visionCall.ts             # Shared helper for vision LLM calls (single mode)
│   ├── llmSingle.ts              # Single-call: image + prompt → structured JSON
│   ├── llmNormalize.ts           # Split structuring: markdown + prompt → JSON
│   ├── mistralOcr.ts             # Mistral OCR API: PDF/image → markdown
│   ├── azapiOcr.ts               # Azure OCR
│   └── resolveKey.ts             # API key + model resolution from settings/env
├── parser/
│   ├── prompt.ts                 # STRUCTURING_PROMPT — instructions for the LLM
│   ├── parser.ts                 # Raw LLM text → ParsedInvoiceData (coerce + unwrap + legacy)
│   └── repair.ts                 # JSON repair: truncated braces, trailing commas, etc.
├── transformer/
│   ├── normalize/
│   │   ├── index.ts              # enrichParsedInvoice() — master enrichment entry point
│   │   ├── vendor.ts             # Seller vs buyer detection, junk name filtering
│   │   ├── vehicle.ts            # Registration number normalization + markdown fallback
│   │   ├── date.ts               # Invoice date normalization + markdown fallback
│   │   ├── footer/               # OCR markdown footer parser (split from monolithic footer.ts)
│   │   │   ├── index.ts          # Footer orchestration
│   │   │   ├── gst.ts            # GST line extraction
│   │   │   ├── chargeTable.ts    # Charge table parsing
│   │   │   ├── discount.ts       # Discount lines
│   │   │   └── cashMemo.ts       # Cash memo totals
│   │   └── totals.ts             # Bill summary reconciliation pipeline
│   ├── validate.ts               # Structural validation rules (amounts, formats)
│   ├── review.ts                 # Human-review flag generation
│   ├── reviewCodes.ts            # Review code constants
│   └── reconcileTotal.ts         # Total reconciliation
├── service/
│   ├── invoiceService.ts         # CRUD, list, filters, cursor pagination (~279 lines)
│   ├── ocrLifecycle.ts           # Upload, queue, OCR, approval workflow (~424 lines)
│   ├── recordActivity.ts         # Shared audit + webhook dispatch helper
│   ├── exportService.ts          # CSV + Excel export (~141 lines)
│   └── reconcileRange.ts         # Date range reconciliation
├── commentRepository.ts          # Invoice comments CRUD
├── mapper.ts                     # Data transformations: ParsedData ↔ BillDoc ↔ FrontendInvoice
├── repository.ts                 # PostgreSQL CRUD (Sequelize)
├── types/
│   ├── invoice.ts                # Re-exports ParsedInvoiceData, BillDoc, etc. from shared
│   ├── parser.ts                 # ValidationIssue, ParseResult
│   ├── provider.ts               # LlmUsage, OcrStepCost, OcrCostInfo
│   └── index.ts                  # Barrel export
├── route.ts                      # Thin HTTP controller (~548 lines, Zod-validated)
├── COST.md                       # Cost documentation
├── FLOW.md                       # End-to-end upload → webhook flow
└── README.md
```

Shared constants used by this module:
- `shared/numbers.ts` — `roundMoney` and numeric helpers
- `shared/ocrConstants.ts` — GST rates, reconciliation tolerances, API timeouts
- `shared/validation.ts` — Zod schemas for upload, comments, invoice updates

## How It Works — Full Flow

### 1. Upload

`POST /api/invoices/upload` → `route.ts` → `ocrLifecycle.uploadInvoices()`:
1. Zod-validates request; validates the file (PDF, JPEG, PNG, or WebP)
2. Uploads to Cloud Storage
3. Creates a placeholder `BillDoc` with `ocr_status: PROCESSING` and `user_id`
4. Enqueues job via pg-boss (`queue/ocrQueue.ts`) — inline fallback in tests
5. Returns `HTTP 202` immediately — OCR runs in the background

See [FLOW.md](./FLOW.md) for the complete diagram.

### 2. Pipeline Orchestration

`process.ts → runPipeline()` reads DB settings, builds the fallback chain, and delegates to `pipeline/fallbackChain.ts`:

**Single Mode**:
```
Buffer → pipeline/single.ts → providers/llmSingle.ts
  → visionCall.ts (shared multimodal helper)
  → One LLM call (image + prompt → JSON)
  → Supports: Gemini, Claude, OpenAI, Mistral
```

**Split Mode**:
```
Buffer → pipeline/split.ts
  → Step 1: providers/mistralOcr.ts or azapiOcr.ts (image → markdown)
  → Step 2: providers/llmNormalize.ts (markdown + prompt → JSON)
```

**Fallback Chain** (`pipeline/fallbackChain.ts`):
Each configured level in Settings is tried in order. The chain moves to the next level on API error **or** total-reconciliation failure (`transformer/reconcileTotal.ts`). The first reconciliation-matched result wins; if none match, the best attempt (smallest total difference) is kept. Each attempt records a `parsed_snapshot` and `recon_breakdown` for UI compare.

### 3. JSON Parsing

`parser/parser.ts → structureFromLlmResponse()`:
1. `repair.ts` fixes truncated braces, trailing commas, Indian number formatting
2. `pickParsedDataBlob()` unwraps various JSON wrapper shapes the LLM returns
3. `coerceParsedInvoiceData()` converts loose types to strict `ParsedInvoiceData`
4. Falls back to legacy canonical format (`vendorName`, `lineItems`) if detected

### 4. Post-Parse Enrichment

`transformer/normalize/index.ts → enrichParsedInvoice()`:
1. **Vendor resolution** (`vendor.ts`) — seller vs buyer GSTIN/name correction
2. **Date normalization** (`date.ts`) — format standardization + markdown fallback
3. **Vehicle details** (`vehicle.ts`) — registration number cleanup
4. **Company name cleanup** — strips table noise, junk names, LLM schema leakage
5. **Invoice number fallback** — Job Card No, Bill No from markdown
6. **PAN from GSTIN** — derives PAN from GSTIN middle 10 chars
7. **Labour filtering** — removes section headers mistakenly extracted as line items
8. **Bill summary** (`totals.ts` + `footer/`) — reconciles subtotals, GST, discounts

### 5. Validation & Review

- `transformer/validate.ts` — structural checks (GST range, amount consistency)
- `transformer/review.ts` — advisory flags for the UI (missing GSTIN, totals mismatch)
- `transformer/reviewCodes.ts` — constants for review codes (`TOTAL_MISMATCH`, `PARTS_BASE_MISMATCH`, etc.)

### 6. Mapping & Storage

- `mapper.ts → mapParsedToBill()` — converts to `BillDoc` for PostgreSQL
- `mapper.ts → toApiParsed()` — stable API response contract (IMMUTABLE)
- `mapper.ts → billToInvoice()` — frontend-ready shape
- `models/bill.ts` + `models/billPart.ts` + `models/invoiceComment.ts` — Sequelize model definitions
- `repository.ts` — PostgreSQL CRUD for bills and bill_parts via `./models/index.js`

Worker persistence (`queue/ocrWorker.ts`): update bill → saveBillParts → upsertVendor → deductTokens → `recordActivity`.

## Service Layer

Business logic is split between CRUD and OCR lifecycle:

### `service/invoiceService.ts` (~279 lines)

Invoice CRUD and queries. Route handlers call these functions — never access repository directly for business rules.

| Function | What it does |
|----------|-------------|
| `listInvoices(filters)` | Cursor-paginated list with server-side filters |
| `getStatusCounts()` | Status counts (scoped to user unless admin) |
| `getInvoice(id, userId?)` | Single invoice + parts |
| `getInvoiceForUi(id, userId?)` | Frontend-ready shape |
| `getInvoiceForApi(bill)` | API response shape |
| `getInvoiceFile(id, userId?)` | Signed file URL from GCS |
| `updateInvoice(id, patch, userId?)` | Human edit (preserves `parsed_data`) |
| `deleteInvoice(id, userId?)` | Delete bill + parts + GCS file |
| `bulkAction(action, ids, userId?)` | Bulk delete/reextract/cancel |
| `reconcileRange(params)` | Batch reconcile by date range |

### `service/ocrLifecycle.ts` (~424 lines)

Upload, background OCR, sync/async API, and approval workflow.

| Function | What it does |
|----------|-------------|
| `uploadInvoices(files, userId?)` | Validate → store → create PROCESSING bill → enqueue OCR |
| `importFromUrls(urls, userId?)` | Download from URLs → process like uploads |
| `reextractInvoice(id, userId?)` | Re-run OCR pipeline on existing bill |
| `processDraft(id, userId?)` | Process a DRAFT bill (from email intake) |
| `cancelInvoice(id, userId?)` | Cancel processing |
| `statelessParse(buf)` | Parse without persisting |
| `syncOcr(buf, opts)` | Synchronous OCR via API key |
| `asyncOcr(buf, opts)` | Async OCR via API key |
| `submitForApproval(id, userId?)` | Submit for approval |
| `approveInvoice(id, approvedBy)` | Approve + audit + webhook |
| `rejectInvoice(id, rejectedBy, reason)` | Reject + audit + webhook |

### `service/recordActivity.ts`

Shared helper called after invoice lifecycle events:

```typescript
recordActivity(userId, action, webhookEvent, billId, details?)
// → audit() + dispatchWebhookEvent() (if event is non-null)
```

Used by `invoiceService.ts`, `ocrLifecycle.ts`, and `queue/ocrWorker.ts`.

See [../audit/README.md](../audit/README.md) and [../webhook/README.md](../webhook/README.md).

### `service/exportService.ts` (~141 lines)

| Function | What it does |
|----------|-------------|
| `exportInvoicesCsv()` | Bills CSV |
| `exportLineItemsCsv()` | Line items CSV |
| `exportFilteredInvoicesExcel(filters)` | Filtered .xlsx via exceljs |
| `exportToExcel(bills)` | Build Excel workbook buffer |

### Server-Side Filters & Pagination

`GET /api/invoices` supports:

| Query param | Effect |
|-------------|--------|
| `cursor` | ISO timestamp — returns rows with `created_at < cursor` (not OFFSET) |
| `limit` | Page size (1–100, default 10) |
| `status` / `statuses` | Filter by OCR status |
| `q` | Search vendor name, company name, invoice #, registration (ILIKE) |
| `vendor` | Company name ILIKE filter |
| `minTotal` / `maxTotal` | Grand total range |
| `dateFrom` / `dateTo` | Invoice date range |
| `needsReview` / `reviewCode` | Review flags |

Regular users automatically get `user_id` scoped to their session. Admins see all bills.

Implemented in `repository.ts` (`buildBillListWhere`, `listBillsCursor`).

## Comments

Users can add notes on the invoice detail page.

| Method | Path | Handler |
|--------|------|---------|
| `GET` | `/api/invoices/:id/comments` | `commentRepository.getComments` |
| `POST` | `/api/invoices/:id/comments` | `commentRepository.addComment` (Zod: 1–2000 chars) |

Model: `models/invoiceComment.ts` → table `invoice_comments` (see [DATABASE.md](../../DATABASE.md)).

## Batch Reconciliation

`service/reconcileRange.ts` — re-runs review and total reconciliation for bills in a `created_at` date range. Exposed as `POST /api/invoices/reconcile-range` with `mode=check` (dry-run preview) or `mode=update` (persist review fields and status).

## How to Change the OCR Model

1. Settings UI → configure fallback chain levels (Single or Split mode per level)
2. Saved to PostgreSQL
3. Next upload reads the chain and tries each level in order
4. Bill is stamped with which model was used and full fallback history

## How to Add a New LLM Provider

1. Add provider config in `providers/resolveKey.ts`
2. Add API call in `providers/llmSingle.ts` (single, via `visionCall.ts`) or `providers/llmNormalize.ts` (split)
3. The rest of the pipeline (parsing, enrichment, mapping) is provider-agnostic

## Testing

Tests are in `tests/ocr/` — run with `npm test`.

Critical suites:
- `structureAccuracy.test.ts` — end-to-end parsing with real invoice shapes
- `normalize.test.ts` — field enrichment correctness
- `vendorExtract.test.ts` — seller vs buyer detection
- `footerExtract.test.ts` — GST footer parsing
- `billMapper.test.ts` — bill mapping
