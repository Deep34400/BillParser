# BillParser Platform — Complete Architecture Documentation

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [End-to-End Bill Processing Flow](#end-to-end-bill-processing-flow)
4. [OCR Pipeline — Step by Step (What Happens in Parallel)](#ocr-pipeline--step-by-step)
5. [Provider System — How to Change/Add Providers](#provider-system)
6. [Settings & Configuration Flow](#settings--configuration-flow)
7. [Firestore Database Design](#firestore-database-design)
8. [API Reference](#api-reference)
9. [Analytics Service & UI](#analytics-service--ui)
10. [Fraud Detection Service & UI](#fraud-detection-service--ui)
11. [Frontend Architecture](#frontend-architecture)
12. [File-by-File Reference](#file-by-file-reference)
13. [Local Development vs Production — What Changes](#local-vs-production)
14. [Deployment](#deployment)

---

## Tech Stack


| Layer                | Technology                         | Why                                           |
| -------------------- | ---------------------------------- | --------------------------------------------- |
| **Runtime**          | Node.js 20 + TypeScript            | Type safety, ecosystem                        |
| **API Framework**    | Fastify 5                          | Fast, schema validation, multipart            |
| **Database**         | Cloud Firestore                    | Schemaless, auto-scaling, no connection pools |
| **File Storage**     | Cloud Storage                      | Scalable blob storage for PDFs/images         |
| **OCR Extraction**   | Mistral OCR (`mistral-ocr-latest`) | High accuracy PDF → markdown                  |
| **AI Normalization** | Google Gemini (`gemini-2.5-flash`) | Markdown → structured JSON                    |
| **Frontend**         | React 18 + Vite + TypeScript       | Fast dev, SPA                                 |
| **Routing**          | React Router 6                     | Client-side routing                           |
| **Testing**          | Vitest                             | Fast, TypeScript-native                       |
| **Deployment**       | Docker + Cloud Run                 | Containerized, auto-scaling                   |


### Key npm packages

**Backend (platform/):**

- `firebase-admin` — Firestore + Cloud Storage access
- `@google/generative-ai` — Gemini API client
- `@fastify/multipart` — PDF file upload handling
- `dotenv` — Environment variable loading

**Frontend (web/):**

- `react`, `react-dom`, `react-router-dom`
- `vite` — Build tooling

---

## Project Structure

```
├── platform/                    # Backend (GCP/Firebase)
│   ├── src/
│   │   ├── index.ts             # Server entry — loads .env, starts Fastify
│   │   ├── app.ts               # Fastify app builder — registers all routes
│   │   │
│   │   ├── config/
│   │   │   ├── env.ts           # Environment variables (API keys, ports, flags)
│   │   │   └── firebase.ts      # Firebase Admin init (Firestore + Storage)
│   │   │
│   │   ├── models/              # Firestore data layer
│   │   │   ├── types.ts         # ALL types (OCR contract, BillDoc, BillPartDoc, API envelope)
│   │   │   ├── bills.ts         # CRUD for 'bills' collection
│   │   │   ├── billParts.ts     # CRUD for 'bill_parts' collection + extraction logic
│   │   │   └── settings.ts      # App settings + provider credentials storage
│   │   │
│   │   ├── providers/           # OCR + AI providers
│   │   │   ├── mistralOcr.ts    # Mistral OCR API — PDF buffer → markdown
│   │   │   ├── geminiNormalize.ts # Gemini API — markdown → ParsedInvoiceData
│   │   │   ├── pipeline.ts      # Combined: mistralOcr → geminiNormalize
│   │   │   └── types.ts         # CanonicalResult, provider interfaces
│   │   │
│   │   ├── parsing/             # LLM response parsing (from original system)
│   │   │   ├── prompt.ts        # STRUCTURING_PROMPT — the exact instructions Gemini follows
│   │   │   ├── parse.ts         # JSON → ParsedInvoiceData coercion
│   │   │   ├── coerce.ts        # Type coercion helpers (toNum, toStr, etc.)
│   │   │   ├── validate.ts      # Business validation rules
│   │   │   ├── types.ts         # ParsedInvoiceData interface (OCR contract)
│   │   │   ├── legacy.ts        # Legacy format parser
│   │   │   └── index.ts         # structureFromLlmResponse — main entry point
│   │   │
│   │   ├── billing/             # GST/tax/footer calculation logic
│   │   │   ├── billSummary.ts   # resolveBillSummary — GST reconciliation
│   │   │   ├── footerExtract.ts # extractSummaryFromMarkdown — footer parsing
│   │   │   ├── normalize.ts     # enrichParsedInvoice — post-processing
│   │   │   └── dateExtract.ts   # extractInvoiceDateFromMarkdown
│   │   │
│   │   ├── response/
│   │   │   └── toCanonical.ts   # ParsedInvoiceData → CanonicalResult mapping
│   │   │
│   │   ├── services/
│   │   │   ├── billing/
│   │   │   │   ├── billProcessingService.ts  # Upload → OCR → Normalize → Store
│   │   │   │   └── billMapper.ts             # ParsedInvoiceData → BillDoc
│   │   │   ├── analytics/
│   │   │   │   └── analyticsService.ts       # Dashboard, vehicle, vendor, cost/km
│   │   │   └── fraud/
│   │   │       └── fraudDetectionService.ts  # Duplicates, GST, price, odometer
│   │   │
│   │   ├── routes/              # HTTP endpoints
│   │   │   ├── bills.ts         # /api/invoices/* (14 endpoints)
│   │   │   ├── analytics.ts     # /api/analytics, /api/batches
│   │   │   ├── fraud.ts         # /api/fraud/* (5 endpoints)
│   │   │   ├── config.ts        # /api/config
│   │   │   └── settings.ts      # /api/settings/* (5 endpoints)
│   │   │
│   │   └── lib/                 # Shared utilities
│   │       ├── toApiParsed.ts   # OCR response normalizer (IMMUTABLE contract)
│   │       ├── apiResponse.ts   # Standard {success, data, errors} envelope
│   │       ├── billToInvoice.ts # BillDoc → frontend Invoice shape
│   │       ├── storage.ts       # Cloud Storage upload/download + file detection
│   │       └── devStore.ts      # In-memory store for LOCAL_DEV mode
│   │
│   ├── tests/                   # 42 tests across 6 files
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── web/                         # Frontend (React SPA)
│   ├── src/
│   │   ├── api/client.ts        # API client — 20 endpoints
│   │   ├── types/index.ts       # 15 TypeScript interfaces
│   │   ├── pages/               # 4 pages (Invoices, Detail, Analytics, Settings)
│   │   ├── components/          # 7 UI components
│   │   ├── overlays/            # BakeoffOverlay, CompareOverlay
│   │   ├── hooks/               # usePolling
│   │   └── lib/                 # format, summaryFromMarkdown, structuringModels
│   ├── nginx.conf               # Production proxy: /api/ → backend:4000
│   └── Dockerfile
│
├── docker-compose.yml           # api + web (no PostgreSQL)
└── .env                         # API keys + config
```

---

## End-to-End Bill Processing Flow

This is what happens when a user uploads a PDF invoice:

```
┌──────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React)                          │
│                                                                  │
│  User clicks "Upload bills" → selects PDF                        │
│       ↓                                                          │
│  api.upload(files) → POST /api/invoices/upload (FormData)        │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│                     BACKEND (platform/)                           │
│                                                                  │
│  routes/bills.ts                                                 │
│    │  Receives multipart file, extracts Buffer                   │
│    │  Validates: isPdf(buf) or isImage(buf)                      │
│    ▼                                                             │
│  services/billing/billProcessingService.ts → processUpload()     │
│    │                                                             │
│    ├─ 1. UPLOAD: lib/storage.ts → uploadFile(buf)                │
│    │     → Cloud Storage (or local:// in LOCAL_DEV)              │
│    │     → Returns { storagePath, publicUrl }                    │
│    │                                                             │
│    ├─ 2. CREATE BILL: models/bills.ts → createBill()             │
│    │     → Firestore 'bills' collection                          │
│    │     → Status: UPLOADED                                      │
│    │                                                             │
│    ├─ 3. STATUS UPDATE → PROCESSING                              │
│    │                                                             │
│    ├─ 4. OCR: providers/mistralOcr.ts → mistralOcr(buf)          │
│    │     → POST https://api.mistral.ai/v1/ocr                   │
│    │     → model: mistral-ocr-latest                             │
│    │     → Sends PDF as base64 data URL                          │
│    │     → Returns: markdown string                              │
│    │                                                             │
│    ├─ 5. NORMALIZE: providers/geminiNormalize.ts                 │
│    │     → geminiNormalize(rawOcr)                               │
│    │     → Uses STRUCTURING_PROMPT from parsing/prompt.ts        │
│    │     → Gemini returns JSON matching the invoice schema       │
│    │     → parsing/index.ts → structureFromLlmResponse()         │
│    │       → parsing/parse.ts → coerces JSON to types            │
│    │       → parsing/validate.ts → validates fields              │
│    │       → billing/normalize.ts → enrichParsedInvoice()        │
│    │         → billing/footerExtract.ts → GST footer parsing     │
│    │         → billing/billSummary.ts → GST reconciliation       │
│    │     → Returns: ParsedInvoiceData                            │
│    │                                                             │
│    ├─ 6. SHAPE: lib/toApiParsed.ts → toApiParsed(parsed)         │
│    │     → Normalizes nulls, resolves GST rate sides             │
│    │     → Returns immutable OCR response shape                  │
│    │                                                             │
│    ├─ 7. MAP: services/billing/billMapper.ts                     │
│    │     → mapParsedToBill() → creates BillDoc                   │
│    │     → Status: OCR_COMPLETED                                 │
│    │                                                             │
│    ├─ 8. STORE BILL: models/bills.ts → updateBillStatus()        │
│    │     → Firestore 'bills' — full bill with parsed_data        │
│    │                                                             │
│    ├─ 9. EXTRACT PARTS: models/billParts.ts                      │
│    │     → extractPartsFromParsed() + saveBillParts()             │
│    │     → Creates separate PART/LABOUR documents                │
│    │     → Firestore 'bill_parts' collection                     │
│    │                                                             │
│    └─ 10. RETURN: { bill, partsCount }                           │
└──────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────┐
│  Frontend receives { created: [bill_id], duplicates, rejected }  │
│  Polls GET /api/invoices every 3 seconds                         │
│  Bill appears in table with vendor, amount, status               │
│  User clicks row → InvoiceDetailPage shows full breakdown        │
└──────────────────────────────────────────────────────────────────┘
```

### Status Flow

```
UPLOADED → PROCESSING → OCR_COMPLETED → VERIFIED
                   ↘
                    FAILED
```


| Status          | Meaning                      | Frontend shows      |
| --------------- | ---------------------------- | ------------------- |
| `UPLOADED`      | File stored, OCR not started | PENDING             |
| `PROCESSING`    | Mistral OCR + Gemini running | PROCESSING          |
| `OCR_COMPLETED` | Successfully parsed          | COMPLETED           |
| `VERIFIED`      | Human reviewed & confirmed   | COMPLETED + ✓ badge |
| `FAILED`        | OCR or normalization error   | FAILED + error msg  |


---

## OCR Pipeline — Step by Step

### What happens when you upload a PDF

Everything below runs in the **background** — the HTTP response returns in ~500ms. The frontend polls every 3 seconds to see the result.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 1 — UPLOAD (instant, < 500ms)                                     │
│  routes/bills.ts → POST /api/invoices/upload                            │
│                                                                          │
│  ① Receive multipart file → Buffer                                       │
│  ② Validate: isPdf(buf) or isImage(buf)                                  │
│  ③ Store file: uploadFile(buf) → Cloud Storage (or in-memory LOCAL_DEV)  │
│  ④ Create bill record: createBill() → Firestore with status=PROCESSING   │
│  ⑤ Return { created: [bill_id] } ← frontend gets this instantly         │
│  ⑥ Fire background: processInBackground(billId, buf, ...)               │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (runs async, doesn't block HTTP response)
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 2 — MISTRAL OCR  (~1-8 seconds)                                   │
│  providers/mistralOcr.ts                                                 │
│                                                                          │
│  What: Converts PDF pages → markdown with tables                         │
│  How:                                                                    │
│    POST https://api.mistral.ai/v1/ocr                                    │
│    model: "mistral-ocr-latest"                                           │
│    document: { type: "document_url", document_url: "data:...base64" }    │
│                                                                          │
│  Input:  PDF buffer → base64 data URL                                    │
│  Output: Raw markdown string (tables, headers, text)                     │
│                                                                          │
│  Example output:                                                         │
│    | Part No. | Description | HSN | Qty | Rate | Amount |                │
│    | L-0888   | ENGINE OIL  | 271 | 33  | 48.35| 1595.55|               │
│    ...                                                                   │
│    CGST @ 9%: 494.86                                                     │
│    Grand Total: ₹6,488                                                   │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 3 — AI NORMALIZATION  (~3-7 seconds)                               │
│  providers/mistralNormalize.ts  OR  providers/geminiNormalize.ts         │
│  (controlled by NORMALIZE_PROVIDER env var)                              │
│                                                                          │
│  What: Maps raw markdown → structured JSON (ParsedInvoiceData)           │
│  How:                                                                    │
│    Mistral: POST /v1/chat/completions (model: mistral-small-latest)      │
│    Gemini:  POST generativelanguage.googleapis.com (gemini-2.5-flash)    │
│                                                                          │
│  System prompt: STRUCTURING_PROMPT (parsing/prompt.ts)                   │
│  Key rules in the prompt:                                                │
│    • Return JSON matching ParsedInvoiceData schema                       │
│    • Line items are GROSS (before discount)                              │
│    • GST amounts copied from footer — never calculated                   │
│    • CGST+SGST for intra-state, IGST for inter-state                     │
│    • confidence: 0..1                                                    │
│                                                                          │
│  If JSON is invalid → retry with error message → parse again             │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 4 — POST-PROCESSING  (< 100ms, no API calls)                      │
│                                                                          │
│  ① structureFromLlmResponse(text, rawOcr)   — parsing/index.ts          │
│     ├─ parseStructuredOutput()              — parsing/parse.ts           │
│     │    coerce JSON fields to correct types (toNum, toStr)              │
│     ├─ validateParsedInvoice()              — parsing/validate.ts        │
│     │    check business rules (valid dates, positive amounts)            │
│     └─ toCanonicalResult()                  — response/toCanonical.ts    │
│                                                                          │
│  ② toApiParsed(parsed)                      — lib/toApiParsed.ts        │
│     normalize nulls, resolve GST rate sides (IGST vs CGST/SGST)         │
│     THIS IS THE IMMUTABLE OCR CONTRACT — never modify this shape        │
│                                                                          │
│  ③ mapParsedToBill(billId, parsed)          — services/billing/mapper   │
│     extract header fields (vendor, GSTIN, PAN, dates, vehicle)           │
│     calculate total_tax_amount from GST parts/labour fields              │
│     embed parsed_data as the "source of truth"                           │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 5 — SAVE & COMPLETE  (< 50ms)                                     │
│                                                                          │
│  ① updateBillStatus(billId, 'OCR_COMPLETED', bill)                       │
│     → Firestore 'bills' — full bill document with parsed_data            │
│                                                                          │
│  ② extractPartsFromParsed(billId, parsed)                                │
│     → Separate PART/LABOUR line items into individual documents           │
│     → saveBillParts() → Firestore 'bill_parts'                           │
│                                                                          │
│  ③ Console log: "[OCR] abc123 — DONE in 7.3s (6 parts)"                 │
│                                                                          │
│  IF ANY STEP FAILS:                                                      │
│  → updateBillStatus(billId, 'FAILED', { processing_status: error.msg })  │
│  → Frontend shows red "Failed" status with error message                 │
└──────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 6 — FRONTEND DISPLAYS RESULT                                      │
│                                                                          │
│  Frontend polls GET /api/invoices every 3 seconds                        │
│  When status changes PROCESSING → OCR_COMPLETED:                         │
│    → Table row updates: vendor name, amount, status=Completed            │
│    → Click row → InvoiceDetailPage shows:                                │
│       Left: PDF preview (iframe from /api/invoices/:id/file)             │
│       Right: parsed data (parts table, labour table, GST summary)        │
└──────────────────────────────────────────────────────────────────────────┘
```

### Timing breakdown (typical 2-page invoice)


| Step                 | Time       | Where                           |
| -------------------- | ---------- | ------------------------------- |
| Upload + create bill | ~50ms      | `routes/bills.ts`               |
| Mistral OCR          | 1-8s       | Mistral API (network)           |
| AI Normalization     | 3-7s       | Mistral or Gemini API (network) |
| Post-processing      | <100ms     | Local CPU                       |
| Save to DB           | <50ms      | Firestore or in-memory          |
| **Total**            | **~5-15s** | Mostly API latency              |


### What runs in parallel vs sequential

```
HTTP Request ──── Upload file ──── Create bill ──── Return response (500ms)
                                        │
                            Background async task:
                                        │
                          Mistral OCR ────────► AI Normalize ────────► Save
                          (sequential — normalize needs OCR output)
                                        
                          Meanwhile: frontend polls every 3s
                                    other uploads can happen in parallel
```

Multiple file uploads are **independent** — each gets its own background task.

---

## Provider System

### How to Change OCR Provider

Currently: **Mistral OCR → Mistral normalization** (single API key)

### Switch normalization: Mistral ↔ Gemini

Edit `platform/.env`:

```bash
NORMALIZE_PROVIDER=mistral   # default — uses MISTRAL_API_KEY
NORMALIZE_PROVIDER=gemini    # needs valid GEMINI_API_KEY with billing credits
```

Where it's wired: `routes/bills.ts` → `pickNormalize()` reads `NORMALIZE_PROVIDER`.

### Add a new OCR provider (code)

1. Create `platform/src/providers/yourProvider.ts`:

```typescript
export async function yourOcr(buf: Buffer): Promise<string> {
  // Call your OCR API, return markdown string
}
```

1. Import in `platform/src/routes/bills.ts` and use in `processInBackground()`

### Settings UI ([http://localhost:5173/settings](http://localhost:5173/settings))

Saves provider preferences + API keys to Firestore. Currently the upload pipeline uses env vars, but the settings UI stores credentials for future provider-registry integration.

### Available Providers (from Settings page)


| Provider               | Kind       | Use for           | Required credentials                              |
| ---------------------- | ---------- | ----------------- | ------------------------------------------------- |
| Mistral OCR            | markdown   | OCR extraction    | `apiKey`                                          |
| Google Gemini          | markdown   | OCR + Structuring | `apiKey`                                          |
| Azure Doc Intelligence | structured | OCR extraction    | `apiKey`, `endpoint`                              |
| Google Document AI     | structured | OCR extraction    | `keyJson`, `location`, `processorId`, `projectId` |
| LlamaParse             | markdown   | OCR extraction    | `apiKey`                                          |
| AWS Textract           | structured | OCR extraction    | `accessKeyId`, `secretAccessKey`, `region`        |
| GLM-OCR (Ollama)       | markdown   | Local OCR         | `baseUrl`, `model`                                |


### Provider Configuration Flow

```
Settings Page
    → PUT /api/settings { extractionProvider, structuringProvider, structuringModel }
    → Stored in Firestore 'settings/app_settings'

Credentials Page
    → PUT /api/settings/providers/{provider} { apiKey: "..." }
    → Stored in Firestore 'provider_credentials/{provider}'

GET /api/config
    → Returns provider list + configured status
    → Frontend shows which providers have keys set
```

---

## Settings & Configuration Flow

```
┌─────────────────────────────────────────────┐
│           Settings Page (Frontend)           │
│                                              │
│  ┌──────────────────────────────┐            │
│  │ Selections                    │            │
│  │ • Active extraction provider  │──────┐     │
│  │ • Structuring model provider  │      │     │
│  │ • Structuring model name      │      │     │
│  │ [Save selections]             │      │     │
│  └──────────────────────────────┘      │     │
│                                         │     │
│  ┌──────────────────────────────┐      │     │
│  │ Provider Credentials          │      │     │
│  │ • Mistral: API key [****]    │──┐   │     │
│  │ • Gemini: API key [****]     │  │   │     │
│  │ • Azure: key + endpoint      │  │   │     │
│  │ [Save] [Clear]               │  │   │     │
│  └──────────────────────────────┘  │   │     │
└─────────────────────────────────────│───│─────┘
                                      │   │
                                      ▼   ▼
┌─────────────────────────────────────────────┐
│              Backend API                     │
│                                              │
│  PUT /api/settings                           │
│    → models/settings.ts → saveSettings()     │
│    → Firestore: settings/app_settings        │
│                                              │
│  PUT /api/settings/providers/mistral         │
│    → saveProviderCredentials('mistral', {})   │
│    → Firestore: provider_credentials/mistral │
│                                              │
│  GET /api/config                             │
│    → Reads settings + checks each provider   │
│    → Returns { providers, activeProvider }   │
└─────────────────────────────────────────────┘
```

---

## Firestore Database Design

### Collection: `bills`

Each document = one invoice. Document ID = `bill_id` (UUID).


| Field                 | Type    | Source     | Description                                       |
| --------------------- | ------- | ---------- | ------------------------------------------------- |
| `bill_id`             | string  | Generated  | UUID primary key                                  |
| `fleet_id`            | string? | Input      | Fleet identifier                                  |
| `vehicle_id`          | string? | Input      | Vehicle identifier                                |
| `bill_type`           | enum    | Input      | MAINTENANCE, FUEL, INSURANCE, TYRE, TOLL, etc.    |
| `bill_category`       | string? | Input      | Sub-category                                      |
| `vendor_name`         | string? | OCR        | Company name from invoice                         |
| `vendor_gstin`        | string? | OCR        | GSTIN from invoice                                |
| `company_name`        | string? | OCR        | Same as vendor_name (from parsed_data)            |
| `gstin`               | string? | OCR        | GSTIN                                             |
| `pan`                 | string? | OCR        | PAN number                                        |
| `irn`                 | string? | OCR        | Invoice Reference Number                          |
| `invoice_number`      | string? | OCR        | Invoice number                                    |
| `invoice_date`        | string? | OCR        | Date as printed (DD/MM/YYYY, etc.)                |
| `invoice_time`        | string? | OCR        | Time as printed                                   |
| `subtotal_amount`     | number? | OCR        | sub_total_calculated                              |
| `parts_amount`        | number? | OCR        | parts_total                                       |
| `labour_amount`       | number? | OCR        | labour_total                                      |
| `parts_cgst_amount`   | number? | OCR        | Parts CGST amount                                 |
| `parts_sgst_amount`   | number? | OCR        | Parts SGST amount                                 |
| `parts_igst_amount`   | number? | OCR        | Parts IGST amount                                 |
| `parts_cgst_rate`     | number? | OCR        | Parts CGST rate %                                 |
| `parts_sgst_rate`     | number? | OCR        | Parts SGST rate %                                 |
| `parts_igst_rate`     | number? | OCR        | Parts IGST rate %                                 |
| `labour_cgst_amount`  | number? | OCR        | Labour CGST amount                                |
| `labour_sgst_amount`  | number? | OCR        | Labour SGST amount                                |
| `labour_igst_amount`  | number? | OCR        | Labour IGST amount                                |
| `labour_cgst_rate`    | number? | OCR        | Labour CGST rate %                                |
| `labour_sgst_rate`    | number? | OCR        | Labour SGST rate %                                |
| `labour_igst_rate`    | number? | OCR        | Labour IGST rate %                                |
| `total_tax_amount`    | number? | Calculated | Sum of all GST fields                             |
| `grand_total_amount`  | number? | OCR        | grand_total_invoice                               |
| `deductibles`         | number? | OCR        | Deductible amount                                 |
| `salvage`             | number? | OCR        | Salvage amount                                    |
| `odometer_reading`    | number? | OCR        | Mileage reading                                   |
| `registration_number` | string? | OCR        | Vehicle registration                              |
| `chassis_number`      | string? | OCR        | Chassis number                                    |
| `ocr_status`          | enum    | System     | UPLOADED/PROCESSING/OCR_COMPLETED/VERIFIED/FAILED |
| `processing_status`   | string? | System     | Error message on failure                          |
| `confidence_score`    | number? | OCR        | 0-1 confidence                                    |
| `file_url`            | string? | System     | Cloud Storage public URL                          |
| `storage_path`        | string? | System     | Cloud Storage path                                |
| `raw_ocr_reference`   | string? | System     | First 10KB of raw OCR markdown                    |
| `parsed_data`         | object  | OCR        | **IMMUTABLE** — complete OCR response             |
| `schema_version`      | number  | System     | Currently 1                                       |
| `created_at`          | string  | System     | ISO timestamp                                     |
| `updated_at`          | string  | System     | ISO timestamp                                     |


**GST Handling Rules:**

- Store GST values **as-is** from OCR — never recalculate
- If rate is present but amount is unclear → store rate, leave amount null
- `parsed_data` is the **immutable source of truth** — never modify
- Bill is either intra-state (CGST+SGST) or inter-state (IGST), never both

### Collection: `bill_parts`

Each document = one line item (part or labour). Document ID = `part_id` (UUID).


| Field              | Type    | Source     | Description                                 |
| ------------------ | ------- | ---------- | ------------------------------------------- |
| `part_id`          | string  | Generated  | UUID primary key                            |
| `bill_id`          | string  | Reference  | Links to bills collection                   |
| `line_type`        | enum    | Extracted  | `PART` or `LABOUR`                          |
| `name`             | string? | OCR        | item_name_description or labour_description |
| `description`      | string? | OCR        | Same as name                                |
| `quantity`         | number? | OCR        | Quantity (1 for labour)                     |
| `rate`             | number? | OCR        | Unit rate or labour_charges                 |
| `amount`           | number? | OCR        | taxable_amount or labour_charges            |
| `tax_percentage`   | number? | OCR        | GST % for this line                         |
| `tax_amount`       | number? | Calculated | Tax on this line                            |
| `part_number`      | string? | OCR        | part_number_item_code or labour_code        |
| `hsn_sac_code`     | string? | OCR        | HSN/SAC code                                |
| `manufacturer`     | string? | Future     | Part manufacturer                           |
| `normalized_name`  | string? | Future     | Normalized name for analytics               |
| `confidence_score` | number? | OCR        | Line-level confidence                       |
| `created_at`       | string  | System     | ISO timestamp                               |


**Why separate?** Enables per-part analytics: cost/km, vendor comparison, part lifecycle, price benchmarking.

### Collection: `settings`

Single document `app_settings`:


| Field                 | Type    | Description                          |
| --------------------- | ------- | ------------------------------------ |
| `extractionProvider`  | string  | Active OCR provider (e.g. "mistral") |
| `structuringProvider` | string  | Active AI normalizer (e.g. "gemini") |
| `structuringModel`    | string  | Model name (e.g. "gemini-2.5-flash") |
| `extractionModel`     | string? | OCR model override                   |


### Collection: `provider_credentials`

One document per provider (e.g. `mistral`, `gemini`):


| Field      | Type   | Description                                       |
| ---------- | ------ | ------------------------------------------------- |
| `apiKey`   | string | API key                                           |
| *(varies)* | string | Provider-specific fields (endpoint, region, etc.) |


---

## API Reference

### Bill Endpoints


| Method   | Path                                  | Description              | Request                   | Response                            |
| -------- | ------------------------------------- | ------------------------ | ------------------------- | ----------------------------------- |
| `GET`    | `/api/invoices`                       | List all bills           | —                         | `{ invoices: Invoice[] }`           |
| `GET`    | `/api/invoices/:id`                   | Get single bill + parts  | —                         | `Invoice`                           |
| `GET`    | `/api/invoices/:id/file`              | Redirect to PDF          | —                         | 302 redirect                        |
| `POST`   | `/api/invoices/upload`                | Upload PDFs              | multipart                 | `{ created, duplicates, rejected }` |
| `POST`   | `/api/invoices/import`                | Import from URLs         | `{ sources, batchName? }` | `{ created, duplicates, rejected }` |
| `POST`   | `/api/invoices/:id/reextract`         | Re-run OCR               | `{ provider? }`           | `{ ok }`                            |
| `POST`   | `/api/invoices/:id/cancel`            | Cancel extraction        | `{}`                      | `{ ok }`                            |
| `PATCH`  | `/api/invoices/:id`                   | Edit fields (verify)     | `{ vendorName, ... }`     | `Invoice`                           |
| `DELETE` | `/api/invoices/:id`                   | Delete bill + parts      | —                         | `{ ok }`                            |
| `POST`   | `/api/invoices/bulk`                  | Bulk reextract/delete    | `{ action, ids }`         | `{ ok }`                            |
| `GET`    | `/api/invoices/export/csv`            | Export bills CSV         | query params              | CSV file                            |
| `GET`    | `/api/invoices/export/line-items.csv` | Export parts CSV         | query params              | CSV file                            |
| `POST`   | `/api/parse`                          | One-shot stateless parse | multipart or `{ source }` | `{ output: { entries } }`           |


### Authentication Endpoints

| Method   | Path                       | Auth    | Description                                       |
| -------- | -------------------------- | ------- | ------------------------------------------------- |
| `POST`   | `/api/auth/login`          | Public  | Email + password → JWT token (7-day session)      |
| `POST`   | `/api/auth/api-keys`       | JWT     | Generate a new API key for current user            |
| `GET`    | `/api/auth/api-keys`       | JWT     | List current user's API keys (no secrets)          |
| `DELETE` | `/api/auth/api-keys/:id`   | JWT     | Revoke an API key                                 |

### Account Endpoints

| Method | Path                     | Auth      | Description                    |
| ------ | ------------------------ | --------- | ------------------------------ |
| `GET`  | `/api/account`           | JWT / Key | Current user profile + balance |
| `GET`  | `/api/account/transactions` | JWT / Key | Token usage history         |

### Admin Endpoints (admin role only)

| Method   | Path                                | Description                          |
| -------- | ----------------------------------- | ------------------------------------ |
| `GET`    | `/api/admin/users`                  | List all users                       |
| `POST`   | `/api/admin/users`                  | Create user (email, name, password)  |
| `GET`    | `/api/admin/users/:id`              | Get single user                      |
| `PATCH`  | `/api/admin/users/:id/block`        | Block user                           |
| `PATCH`  | `/api/admin/users/:id/unblock`      | Unblock user                         |
| `POST`   | `/api/admin/users/:id/tokens`       | Add balance to user                  |
| `GET`    | `/api/admin/users/:id/transactions` | User's transaction history           |
| `PATCH`  | `/api/admin/users/:id/reset-password` | Reset user's password              |

### OCR API Endpoints (for direct API usage)

| Method | Path             | Auth     | Description                                         |
| ------ | ---------------- | -------- | --------------------------------------------------- |
| `POST` | `/api/ocr/sync`  | API Key  | Synchronous OCR — waits for result, returns parsed data |
| `POST` | `/api/ocr/async` | API Key  | Async OCR — returns bill_id, poll for result         |

**Sync OCR** (`POST /api/ocr/sync`):
- Accepts: multipart file upload OR `{ "url": "https://..." }`
- Waits for full OCR pipeline (5-15s)
- Returns: `{ success, data: { parsed_data, raw_ocr, cost, latency_ms } }`
- Cost is deducted from user balance automatically

**Async OCR** (`POST /api/ocr/async`):
- Accepts: same as sync
- Returns immediately (HTTP 202): `{ success, data: { bill_id, status, poll_url } }`
- Poll `GET /api/invoices/:bill_id` for result
- Cost is deducted after OCR completes

```bash
# Sync example (waits for result)
curl -X POST http://localhost:4000/api/ocr/sync \
  -H "Authorization: Bearer inv_your_api_key" \
  -F "file=@invoice.pdf"

# Sync with URL
curl -X POST http://localhost:4000/api/ocr/sync \
  -H "Authorization: Bearer inv_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://s3.example.com/invoice.pdf"}'

# Async example (returns bill_id, poll later)
curl -X POST http://localhost:4000/api/ocr/async \
  -H "Authorization: Bearer inv_your_api_key" \
  -F "file=@invoice.pdf"
# → { "data": { "bill_id": "abc-123", "poll_url": "/api/invoices/abc-123" } }

# Poll for result
curl http://localhost:4000/api/invoices/abc-123 \
  -H "Authorization: Bearer inv_your_api_key"
```

### Analytics Endpoints


| Method | Path             | Response                                                                        |
| ------ | ---------------- | ------------------------------------------------------------------------------- |
| `GET`  | `/api/analytics` | `{ totalSpend, completedCount, avgConfidence, needsReview, byVendor, byMonth }` |
| `GET`  | `/api/batches`   | `{ batches: [] }` (stub)                                                        |


### Fraud Detection Endpoints

All return: `{ success, message, data: FraudAlert[], metadata, errors }`


| Method | Path                         | Description                        |
| ------ | ---------------------------- | ---------------------------------- |
| `GET`  | `/api/fraud/scan`            | Run ALL fraud checks               |
| `GET`  | `/api/fraud/duplicates`      | Same invoice_number + vendor_gstin |
| `GET`  | `/api/fraud/gst-anomalies`   | Tax ≠ rate × base                  |
| `GET`  | `/api/fraud/price-anomalies` | Parts priced >50% above median     |
| `GET`  | `/api/fraud/odometer`        | Odometer going backward            |


### Config & Settings Endpoints


| Method   | Path                            | Description                                |
| -------- | ------------------------------- | ------------------------------------------ |
| `GET`    | `/api/config`                   | Provider list + active selections          |
| `GET`    | `/api/settings`                 | Current settings + provider status         |
| `PUT`    | `/api/settings`                 | Save extraction/structuring selections     |
| `GET`    | `/api/settings/reveal`          | Get stored credentials (decrypted)         |
| `PUT`    | `/api/settings/providers/:name` | Save provider credentials                  |
| `DELETE` | `/api/settings/providers/:name` | Clear provider credentials                 |
| `GET`    | `/api/health`                   | `{ success, data: { status: "healthy" } }` |


---

## Analytics Service & UI

**Backend:** `services/analytics/analyticsService.ts` + `routes/analytics.ts`
**Frontend:** `web/src/pages/AnalyticsPage.tsx`
**Route:** [http://localhost:5173/analytics](http://localhost:5173/analytics)

### What the Analytics page shows

```
┌─────────────────────────────────────────────────────────────────┐
│  Analytics                                                       │
│  Spend across 5 extracted invoices                              │
│                                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │TOTAL SPEND│ │  PARTS   │ │ LABOUR   │ │ TAX PAID │  ...      │
│  │ ₹32,440  │ │ ₹12,960  │ │ ₹16,875  │ │ ₹4,948   │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
│                                                                  │
│  ┌────────────────────────┐ ┌────────────────────────┐          │
│  │ Top vendors by spend   │ │ Spend by month          │         │
│  │ Arpanna Motors ██████  │ │ 2026-05 ██████          │         │
│  │ JSB Mobility  ████    │ │ 2026-06 ████            │         │
│  └────────────────────────┘ └────────────────────────┘          │
│                                                                  │
│  ┌────────────────────────┐ ┌────────────────────────┐          │
│  │ Vehicle spend breakdown│ │ Cost per kilometer      │         │
│  │ MH01EW8853   ₹6,488   │ │ MH01EW8853  ₹2.31/km  │         │
│  │  3 bills | Parts ₹2.5k│ │  Total ₹12k | 5200 km  │         │
│  └────────────────────────┘ └────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

### Analytics API: `GET /api/analytics`

Returns:


| Field            | Type   | Description                                    |
| ---------------- | ------ | ---------------------------------------------- |
| `totalSpend`     | number | Sum of grand_total_amount                      |
| `totalParts`     | number | Sum of parts_amount                            |
| `totalLabour`    | number | Sum of labour_amount                           |
| `totalTax`       | number | Sum of total_tax_amount                        |
| `completedCount` | number | Bills with OCR_COMPLETED or VERIFIED           |
| `avgConfidence`  | number | Average confidence score (0-1)                 |
| `needsReview`    | number | Bills with confidence < 0.75                   |
| `byVendor`       | array  | Top 10 vendors by spend                        |
| `byMonth`        | array  | Monthly spend totals                           |
| `vehicleSpend`   | array  | Per-vehicle spend breakdown                    |
| `costPerKm`      | array  | Cost/km for vehicles with 2+ odometer readings |


### Backend functions


| Function               | File                  | What it does                                |
| ---------------------- | --------------------- | ------------------------------------------- |
| `getVehicleSpend()`    | `analyticsService.ts` | Groups bills by vehicle, sums amounts       |
| `getVendorAnalytics()` | `analyticsService.ts` | Groups bills by vendor name                 |
| `getCostPerKm()`       | `analyticsService.ts` | min/max odometer → cost_per_km = spend / km |
| `getDashboard()`       | `analyticsService.ts` | Full aggregation (status, type, totals)     |


---

## Fraud Detection Service & UI

**Backend:** `services/fraud/fraudDetectionService.ts` + `routes/fraud.ts`
**Frontend:** `web/src/pages/FraudPage.tsx`
**Route:** [http://localhost:5173/fraud](http://localhost:5173/fraud)

### What the Fraud page shows

```
┌─────────────────────────────────────────────────────────────────┐
│  Fraud Detection                                                 │
│  Scan invoices for anomalies, duplicates, suspicious patterns    │
│                                                                  │
│  ┌────────┐ ┌────────────────┐ ┌──────────────┐ ┌────────────┐ │
│  │🔍 Full │ │📋 Duplicate   │ │📊 GST        │ │💰 Price    │ │
│  │  Scan  │ │   Invoices    │ │   Anomalies  │ │  Anomalies │ │
│  └────────┘ └────────────────┘ └──────────────┘ └────────────┘ │
│                                                                  │
│  ┌─ 3 Total alerts ─┐ ┌─ 1 HIGH ─┐ ┌─ 2 MEDIUM ─┐             │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ [HIGH] [DUPLICATE INVOICE]                                   │ │
│  │ Duplicate invoice: TXA26-01398 from Arpanna Motors          │ │
│  │ 2 bills   ▶                                                  │ │
│  │ ──── expanded ──────────────────────────────────────         │ │
│  │ Bill IDs: f01f841f…, 3473a646…                               │ │
│  │ Details: { invoice_number, vendor, amounts: [6488, 6488] }  │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ [MEDIUM] [GST MISMATCH]                                     │ │
│  │ GST mismatch on invoice DW21S25103620                       │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 4 Fraud Detection Algorithms


| Check                  | Severity | How it works                                                                                                                                                                                                                  |
| ---------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Duplicate Invoices** | HIGH     | Groups by `invoice_number + vendor_gstin`. Count > 1 = alert                                                                                                                                                                  |
| **GST Anomalies**      | MEDIUM   | Combines CGST+SGST+IGST → total GST. `taxable = gross − discount`, intra-state `total = CGST+SGST`, inter-state `total = IGST`. Alert if `|taxable × rate% − actual total GST| > max(₹1, 1%)`. Also checks CGST=SGST symmetry |
| **Price Anomalies**    | MEDIUM   | Groups parts by name, finds median rate. Price >50% above median = alert (needs 3+ of same part)                                                                                                                              |
| **Odometer Issues**    | HIGH     | Sorts bills by date per vehicle. Current odometer < previous = rollback alert                                                                                                                                                 |


### Fraud API endpoints


| Method | Path                         | What it runs             |
| ------ | ---------------------------- | ------------------------ |
| `GET`  | `/api/fraud/scan`            | All 4 checks in parallel |
| `GET`  | `/api/fraud/duplicates`      | Duplicate invoices only  |
| `GET`  | `/api/fraud/gst-anomalies`   | GST mismatches only      |
| `GET`  | `/api/fraud/price-anomalies` | Price outliers only      |
| `GET`  | `/api/fraud/odometer`        | Odometer rollbacks only  |


All return: `{ success, message, data: FraudAlert[], metadata: { total, by_type, by_severity } }`

### FraudAlert shape

```json
{
  "type": "DUPLICATE_INVOICE",
  "severity": "HIGH",
  "message": "Duplicate invoice: TXA26-01398 from Arpanna Motors",
  "bill_ids": ["f01f841f-...", "3473a646-..."],
  "details": {
    "invoice_number": "TXA26-01398",
    "vendor": "Arpanna Motors",
    "count": 2,
    "amounts": [6488, 6488]
  }
}
```

---

## Frontend Architecture

### Pages


| Page                  | Route           | API calls                                                                  |
| --------------------- | --------------- | -------------------------------------------------------------------------- |
| **InvoicesPage**      | `/invoices`     | `list`, `batches`, `config`, `upload`, `import`, `bulk`, `cancel`          |
| **InvoiceDetailPage** | `/invoices/:id` | `get`, `config`, `patch`, `reextract`, `del`, `fileUrl`, `bakeoff`         |
| **AnalyticsPage**     | `/analytics`    | `analytics` (KPIs + vendor + monthly + vehicle + cost/km)                  |
| **FraudPage**         | `/fraud`        | `fraudScan`, `fraudDuplicates`, `fraudGst`, `fraudPrices`, `fraudOdometer` |
| **SettingsPage**      | `/settings`     | `settings`, `revealCreds`, `saveSettings`, `saveCreds`, `clearCreds`       |


### Components


| Component          | Purpose                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| `Shell`            | Layout: left sidebar nav (Invoices, Analytics, Fraud, Settings) + content area |
| `StatusDot`        | Colored status indicator (pulses for PENDING/PROCESSING)                       |
| `ConfidenceBar`    | Confidence bar + "✓ Verified" badge                                            |
| `Toast`            | Bottom toast notification                                                      |
| `InvoiceBreakdown` | Parts/labour tables + parsed metadata + GST summary                            |
| `SummaryBreakdown` | Single-column GST totals                                                       |
| `SummaryColumns`   | Parts/Labour columnwise totals                                                 |


### API Client (`api/client.ts`)

All API calls go through a single `api` object. The Vite dev server proxies `/api/`* to `http://localhost:4000`.

In production, nginx does the same proxy.

---

## File-by-File Reference

### What each file does


| File                                        | One-line purpose                                       |
| ------------------------------------------- | ------------------------------------------------------ |
| `config/env.ts`                             | All environment variables with defaults                |
| `config/firebase.ts`                        | Firebase Admin SDK initialization                      |
| `models/types.ts`                           | Every type: OCR contract, Firestore docs, API envelope |
| `models/bills.ts`                           | Firestore CRUD for bills (with in-memory fallback)     |
| `models/billParts.ts`                       | Firestore CRUD for bill_parts + OCR→parts extraction   |
| `models/settings.ts`                        | Settings + credentials Firestore storage               |
| `providers/mistralOcr.ts`                   | Mistral API call: PDF → markdown                       |
| `providers/geminiNormalize.ts`              | Gemini API call: markdown → ParsedInvoiceData          |
| `providers/pipeline.ts`                     | Combined: mistralOcr → geminiNormalize                 |
| `parsing/prompt.ts`                         | The STRUCTURING_PROMPT Gemini uses                     |
| `parsing/parse.ts`                          | JSON coercion: raw LLM output → typed data             |
| `parsing/validate.ts`                       | Business validation on parsed data                     |
| `parsing/coerce.ts`                         | Type coercion helpers (toNum, toStr)                   |
| `billing/footerExtract.ts`                  | Extract GST footer from OCR markdown                   |
| `billing/billSummary.ts`                    | Reconcile GST (dedup, rate inference)                  |
| `billing/normalize.ts`                      | Post-processing: enrich parsed invoice                 |
| `billing/dateExtract.ts`                    | Fallback date extraction from markdown                 |
| `response/toCanonical.ts`                   | ParsedInvoiceData → CanonicalResult                    |
| `services/billing/billProcessingService.ts` | Full pipeline: upload → OCR → store                    |
| `services/billing/billMapper.ts`            | ParsedInvoiceData → BillDoc for Firestore              |
| `services/analytics/analyticsService.ts`    | Dashboard + vehicle + vendor + cost/km                 |
| `services/fraud/fraudDetectionService.ts`   | 4 fraud detection algorithms                           |
| `routes/bills.ts`                           | 14 invoice HTTP endpoints                              |
| `routes/analytics.ts`                       | Analytics + batches endpoints                          |
| `routes/fraud.ts`                           | 5 fraud scan endpoints                                 |
| `routes/config.ts`                          | App configuration endpoint                             |
| `routes/settings.ts`                        | 5 settings management endpoints                        |
| `lib/toApiParsed.ts`                        | OCR response normalizer (immutable contract)           |
| `lib/apiResponse.ts`                        | Standard `{success, data, errors}` helpers             |
| `lib/billToInvoice.ts`                      | BillDoc → frontend Invoice shape                       |
| `lib/storage.ts`                            | Cloud Storage upload/download                          |
| `lib/devStore.ts`                           | In-memory Maps for LOCAL_DEV mode                      |


---

## Local Development vs Production — What Changes

### Quick comparison


| Aspect               | Local (`LOCAL_DEV=true`)                       | Production (Cloud Run)               |
| -------------------- | ---------------------------------------------- | ------------------------------------ |
| **Database**         | In-memory Maps (resets on restart)             | Cloud Firestore                      |
| **File storage**     | In-memory buffer (served from `/api/.../file`) | Cloud Storage bucket                 |
| **OCR API**          | Real Mistral API (needs key)                   | Same — real Mistral API              |
| **Normalization**    | Real Mistral or Gemini API                     | Same                                 |
| **GCP credentials**  | Not needed                                     | Service account or workload identity |
| **Data persistence** | Lost on server restart                         | Permanent                            |
| **Frontend proxy**   | Vite dev server → `localhost:4000`             | Nginx → `backend:4000`               |
| **PDF preview**      | Served from in-memory buffer                   | Redirect to Cloud Storage URL        |


### What you change to go to production

```
platform/.env (LOCAL)              →    Cloud Run env vars (PRODUCTION)
─────────────────────                   ─────────────────────────────────
LOCAL_DEV=true                     →    (remove — defaults to false)
MISTRAL_API_KEY=xxx                →    MISTRAL_API_KEY=xxx (same)
NORMALIZE_PROVIDER=mistral         →    NORMALIZE_PROVIDER=mistral (same)
                                   →    GCP_PROJECT_ID=your-project
                                   →    STORAGE_BUCKET=your-bucket
                                   →    (service account auto-detected on Cloud Run)
```

### Code that switches behavior


| File                  | What changes                                                      |
| --------------------- | ----------------------------------------------------------------- |
| `config/env.ts`       | `localDev` flag — all behavior flows from this                    |
| `models/bills.ts`     | `if (env.localDev) → devStore.bills.get()` else `→ Firestore`     |
| `models/billParts.ts` | Same pattern                                                      |
| `models/settings.ts`  | Same pattern                                                      |
| `lib/storage.ts`      | `if (env.localDev) → devStore.files.set()` else `→ Cloud Storage` |
| `lib/devStore.ts`     | In-memory Maps (only used when localDev=true)                     |
| `routes/bills.ts`     | `/file` endpoint: streams from devStore or redirects to GCS       |
| `services/fraud/`     | Uses `listBills()` model layer (works in both modes)              |
| `services/analytics/` | Uses `listBills()` model layer (works in both modes)              |


### Local setup

```bash
# Terminal 1 — Backend
cd platform
cp .env.example .env        # edit with your MISTRAL_API_KEY
npm install && npm run dev   # → http://localhost:4000

# Terminal 2 — Frontend
cd web
npm install && npm run dev   # → http://localhost:5173
```

### Run tests

```bash
cd platform && npm test    # 42 tests
cd web && npm test         # Frontend tests
```

---

## Deployment

### Docker Compose (local production)

```bash
docker compose up --build
# API: http://localhost:4000
# Web: http://localhost:8081
```

### Cloud Run (GCP)

```bash
# Build
docker build -t gcr.io/PROJECT_ID/billparser platform/

# Push
docker push gcr.io/PROJECT_ID/billparser

# Deploy
gcloud run deploy billparser \
  --image gcr.io/PROJECT_ID/billparser \
  --region asia-south1 \
  --set-env-vars GCP_PROJECT_ID=PROJECT_ID,STORAGE_BUCKET=your-bucket,MISTRAL_API_KEY=...,GEMINI_API_KEY=...
```

### Environment Variables (Production)


| Variable           | Required | Description                    |
| ------------------ | -------- | ------------------------------ |
| `GCP_PROJECT_ID`   | Yes      | GCP project for Firestore      |
| `STORAGE_BUCKET`   | Yes      | Cloud Storage bucket           |
| `MISTRAL_API_KEY`  | Yes      | Mistral OCR API key            |
| `GEMINI_API_KEY`   | Yes      | Gemini API key                 |
| `GEMINI_MODEL`     | No       | Default: `gemini-2.5-flash`    |
| `LOCAL_DEV`        | No       | `true` for in-memory mode      |
| `FIRESTORE_PREFIX` | No       | Multi-tenant collection prefix |
| `PORT`             | No       | Default: `4000`                |


---

## OCR Response Contract (IMMUTABLE)

This is the `parsed_data` shape. **Do not rename fields or change nesting.**

```json
{
  "irn": null,
  "pan": null,
  "gstin": "07AAGCJ6656E1ZF",
  "company_name": "JSB MOBILITY PVT LTD",
  "invoice_date": "19.03.2026",
  "invoice_time": "19:53:29",
  "invoice_number": "DW21S25103620",
  "service_details": {
    "last_service": null,
    "service_type": "Preventive Maintenance",
    "next_service_due": null
  },
  "vehicle_details": {
    "chassis_number": "M27GD5BEA8H024250",
    "registration_number": "HR55AM4015",
    "mileage_odometer_reading": 62341
  },
  "parts_line_items": [
    {
      "rate": 423.73,
      "quantity": 1,
      "hsn_sac_code": "84212300",
      "tax_percentage": 18,
      "taxable_amount": 423.73,
      "item_name_description": "FILTER-POLLEN",
      "part_number_item_code": "11668822"
    }
  ],
  "labour_service_line_items": [
    {
      "labour_code": "EV4PM60",
      "hsn_sac_code": "998729",
      "labour_charges": 2700,
      "tax_percentage": 18,
      "labour_description": "Paid Service/60000 KM EV"
    }
  ],
  "totals_and_tax_summary": {
    "parts_total": 3527.12,
    "labour_total": 3965,
    "parts_discount": 0,
    "labour_discount": 126.5,
    "parts_cgst_rate": 9,
    "parts_igst_rate": null,
    "parts_sgst_rate": 9,
    "labour_cgst_rate": 9,
    "labour_igst_rate": null,
    "labour_sgst_rate": 9,
    "parts_cgst_amount": 317.44,
    "parts_igst_amount": null,
    "parts_sgst_amount": 317.44,
    "labour_cgst_amount": 345.47,
    "labour_igst_amount": null,
    "labour_sgst_amount": 345.47,
    "sub_total_calculated": 8691.42,
    "grand_total_invoice": 8691,
    "deductibles": null,
    "salvage": null
  },
  "confidence": 0.92
}
```

This contract is consumed by: Frontend, APIs, analytics, fraud detection.