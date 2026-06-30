# Praya Invoice Analyser — Technical Architecture & Implementation

> A self-hosted web application that turns PDF invoices/bills into structured,
> searchable, exportable data. Upload PDFs in the browser, extract fields via a
> pluggable choice of OCR/AI providers, review and correct results, then search,
> analyse and export from a persistent Postgres ledger.

This document describes **what the system does**, **how it is built**, and **how
the pieces fit together**. It is written for an engineer who needs to operate,
extend, or audit the codebase.

---

## 1. System overview

```
┌──────────────────────────────────────────────────────────────────────────┐
│                              Browser (SPA)                                 │
│   React 18 + Vite + React Router — Invoices · Detail · Analytics · Settings│
└───────────────────────────────┬──────────────────────────────────────────┘
                                 │  HTTP/JSON  (nginx serves SPA, proxies /api)
                                 ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         API  (Fastify 4 + Prisma 5)                        │
│                                                                            │
│   Routes ── config · invoices · export · analytics · settings             │
│      │                                                                     │
│      ▼                                                                     │
│   Extraction orchestrator ─────────────────────────────────────────────┐  │
│      │                                                                  │  │
│      ├─ Provider registry  (markdown | structured)                      │  │
│      │     markdown:  ollama · mistral · llamaparse   ── OCR → markdown  │  │
│      │     structured: azure · textract · google      ── direct fields  │  │
│      │                                                                  │  │
│      ├─ Structuring pass (markdown → canonical JSON via LLM)            │  │
│      │     anthropic · openai · mistral · ollama                        │  │
│      │                                                                  │  │
│      ├─ Confidence derivation · cost estimation                         │  │
│      └─ Settings / credential store (AES-256-GCM at rest)               │  │
│                                                                          │  │
└──────────────────────────────────────────────────────────────────────┼──┘
                                 │  Prisma                               │
                                 ▼                                       ▼
                       ┌───────────────────┐                  ┌───────────────────┐
                       │   PostgreSQL 16   │                  │  External providers│
                       │  invoices · runs  │                  │  Mistral · Azure · │
                       │  line items ·     │                  │  LlamaParse ·      │
                       │  settings · creds │                  │  Textract · Ollama │
                       └───────────────────┘                  └───────────────────┘
```

**Core idea:** every PDF flows through a two-shape pipeline. *Markdown* providers
OCR the page to text and then run a second LLM pass to turn that text into a
canonical field schema. *Structured* providers (Azure, Textract) return parsed
fields directly and skip the LLM pass. Either way the output is the **same
canonical result**, so the rest of the system (storage, UI, export, analytics)
is provider-agnostic.

### Stack

| Layer     | Technology                                  |
|-----------|---------------------------------------------|
| Frontend  | React 18 + Vite 5, React Router 6, TypeScript |
| Backend   | Fastify 4 + Prisma 5, TypeScript            |
| Database  | PostgreSQL 16                               |
| Runtime   | Node 20 (api), nginx alpine (web)           |
| Packaging | Docker Compose (db + api + web)             |
| PDF tools | `poppler-utils` (pdftoppm), `pdf-lib`       |

---

## 2. Feature catalogue

| Feature | What it does | Where it lives |
|---------|--------------|----------------|
| **Upload & extract** | Drop one or more PDFs; each is hashed, stored, and queued for async extraction. | `routes/invoices.ts` (upload), `extraction/run.ts` |
| **Deduplication** | Same file (by SHA-256) is never processed twice; reported as a duplicate. | `lib/hash.ts`, `Invoice.fileHash` unique constraint |
| **Ledger UI** | Searchable, filterable, sortable table of all invoices with live status badges. | `pages/InvoicesPage.tsx` |
| **Live status polling** | UI polls every 3 s while any invoice is `PENDING`/`PROCESSING`, stops when settled. | `hooks/usePolling.ts` |
| **Detail / edit / verify** | Per-invoice field view with inline edit; saving marks the record verified. | `pages/InvoiceDetailPage.tsx`, `PATCH /api/invoices/:id` |
| **Re-extract** | Re-run a single invoice against the active or a chosen provider. | `POST /api/invoices/:id/reextract` |
| **Provider bake-off** | Run *all* configured providers against one invoice and compare results side by side, then apply the winner. | `POST /api/invoices/:id/bakeoff`, `apply-run`, `BakeoffOverlay.tsx` |
| **Run history / apply-run** | Every extraction is snapshotted; any past run can be re-applied to the invoice. | `ExtractionRun` model, `POST /api/invoices/:id/apply-run` |
| **Cancellation** | Abort an in-flight extraction; marks it `FAILED` with "Cancelled by user". | `extraction/cancel.ts`, `POST /api/invoices/:id/cancel` |
| **Cost breakdown** | Per-invoice cost split into **extraction (OCR)** vs **structuring (LLM tokens)**, displayed in ₹. | `extraction/confidence.ts` (`splitCost`), `structuring/pricing.ts` |
| **Confidence scoring** | Each invoice gets a 0–1 confidence; low-confidence unverified items flagged "needs review". | `extraction/confidence.ts` |
| **Analytics** | Total spend, completed count, avg confidence, needs-review count, top vendors, spend by month. | `routes/analytics.ts`, `pages/AnalyticsPage.tsx` |
| **CSV export** | Export the filtered ledger or its line items as CSV. | `routes/export.ts`, `lib/csv.ts` |
| **Compare source** | Side-by-side of a paper-like rendering and the raw OCR text. | `CompareOverlay.tsx` |
| **Settings** | Configure provider credentials, the active extraction provider, and the structuring model. | `routes/settings.ts`, `pages/SettingsPage.tsx` |
| **Encrypted credentials** | Provider API keys encrypted at rest with AES-256-GCM keyed from `APP_SECRET`. | `lib/crypto.ts`, `settings/store.ts` |
| **Env seeding** | First-boot defaults seeded from environment variables, then DB takes precedence. | `settings/seed.ts` |
| **Local-by-default** | Ships configured for a fully local Ollama path — runs with zero cloud keys. | `settings/defaults.ts` |

---

## 3. Data model (Prisma / Postgres)

Schema lives in `api/prisma/schema.prisma`. Migrations are applied automatically
on container start (`prisma migrate deploy`).

### Enums

```
InvoiceStatus = PENDING | PROCESSING | COMPLETED | FAILED
RunStatus     = COMPLETED | FAILED
```

### `Invoice` — the canonical ledger row

| Field | Type | Notes |
|-------|------|-------|
| `id` | String (cuid) | PK |
| `fileName` | String | original upload name |
| `storedPath` | String | path to stored PDF on disk |
| `fileHash` | String **@unique** | SHA-256 — deduplication key |
| `status` | InvoiceStatus | default `PENDING` |
| `provider` | String? | provider used for the active result |
| `confidence` | Float? | 0–1 |
| `error` | String? | failure message when `FAILED` |
| `vendorName`, `vendorAddress`, `vendorTaxId` | String? | header fields |
| `invoiceNumber`, `poNumber` | String? | references |
| `invoiceDate`, `dueDate` | DateTime? | parsed dates |
| `currency` | String? | currency code |
| `subtotal`, `taxAmount`, `totalAmount` | Float? | money |
| `paymentTerms` | String? | terms text |
| `rawText` | String? | full OCR / extracted text (audit) |
| `rawJson` | Json? | raw provider response |
| `verified` | Boolean | default `false`; set true on manual save |
| `editedAt` | DateTime? | last manual edit |
| `activeRunId` | String? | points to the applied `ExtractionRun` |
| `createdAt` / `updatedAt` | DateTime | |
| `lineItems` | LineItem[] | 1-to-many |
| `runs` | ExtractionRun[] | 1-to-many |

Indexes: `status`, `vendorName`, `invoiceDate`.

### `LineItem`

`id`, `invoiceId` (FK, cascade delete), `lineNumber` (Int, order), `description?`,
`sku?`, `quantity?`, `unitPrice?`, `amount?`, `taxRate?`. Indexed on `invoiceId`.

### `ExtractionRun` — one record per extraction attempt

Captures the full result of a single provider run so it can be compared or
re-applied later:

`id`, `invoiceId` (FK, cascade), `provider`, `structuringModel?`, `status`
(RunStatus), `confidence?`, `costEstimate?` (USD total), `latencyMs?`,
`pageCount?`, `rawText?`, `rawJson?`, `error?`, **`fieldsSnapshot` (Json)** and
**`itemsSnapshot` (Json)** — the header fields and line items captured so the run
can be re-applied without re-extracting. `createdAt`. Indexed on `invoiceId`.

### `ProviderConfig` — encrypted credentials

`provider` (PK), `credentialsEnc` (String — AES-256-GCM blob), `enabled`
(Boolean), `updatedAt`. One row per provider.

### `Setting` — key/value config

`key` (PK), `value`, `updatedAt`. Holds `extraction_provider`,
`structuring_provider`, `structuring_model`.

---

## 4. The extraction pipeline

`api/src/extraction/run.ts` is the orchestration core. Extraction is
**fire-and-forget async**: the upload endpoint returns immediately and the work
proceeds in the background while the UI polls for status.

### 4.1 Provider resolution

`resolveProvider(invoiceId)` picks the provider in priority order:

1. The configured default extraction provider **if it has credentials**.
2. The invoice's last-used provider, if configured.
3. Any configured provider that works.
4. The raw default (so failures produce a clear "no credentials" message rather
   than silently doing nothing).

### 4.2 Flow

```
runExtraction(invoiceId, providerName?)
  └─ runExtractionWith(invoiceId, provider, creds)
        status → PROCESSING
        startCancellable(invoiceId)               # register AbortController
        buffer  = readFile(storedPath)
        pages   = pageCount(buffer)               # pdf-lib, never throws
        result  = provider.extract(buffer, creds, ctx)   # ← CanonicalResult
        conf    = deriveConfidence(result)
        extractionCost = result.costEstimate ?? estimateCost(provider, pages) ?? 0
        total   = extractionCost + (result.structuringCost ?? 0)
        ── prisma.$transaction ──────────────────────────────
          create ExtractionRun(... fieldsSnapshot, itemsSnapshot ...)
          delete old LineItems; create new LineItems
          update Invoice header + status=COMPLETED + activeRunId
        ─────────────────────────────────────────────────────
        finishCancellable(invoiceId, controller)
   (on error)  status → FAILED, store error message
```

`ctx` (the `ExtractCtx`) carries `fileName`, the chosen `structuring`
`{provider, model}` (for markdown providers), and an `AbortSignal`.

### 4.3 The canonical result

Every provider — markdown or structured — returns a `CanonicalResult`:

```ts
{
  // header (all optional)
  vendorName?, vendorAddress?, vendorTaxId?,
  invoiceNumber?, poNumber?,
  invoiceDate?, dueDate?,        // ISO yyyy-mm-dd
  currency?, subtotal?, taxAmount?, totalAmount?, paymentTerms?,

  lineItems: CanonicalLineItem[],   // { lineNumber, description?, sku?,
                                    //   quantity?, unitPrice?, amount?, taxRate? }

  confidence?,        // 0–1; computed if absent
  rawText: string,    // OCR text / markdown for audit
  rawJson: unknown,   // raw provider response
  costEstimate?,      // USD, extraction (OCR) only
  structuringCost?,   // USD, from LLM token usage
  latencyMs?, pageCount?,
}
```

### 4.4 Confidence

`deriveConfidence` (in `extraction/confidence.ts`):

- If the provider returned an explicit `confidence` in (0, 1], use it (clamped).
- Otherwise compute from field presence:
  `header = (#present of {vendorName, invoiceNumber, invoiceDate, totalAmount, currency, subtotal}) / 6`
  weighted **0.7**, plus `items = (lineItems.length > 0 ? 1 : 0)` weighted **0.3**.
  Rounded to 2 dp.

The UI flags **NEEDS_REVIEW** = `COMPLETED ∧ confidence < 0.75 ∧ !verified`.

### 4.5 Cost model

- `estimateCost(provider, pages)` = `pages × costPer1k / 1000` from the reference
  table (`providers/reference.ts`).
- `splitCost(provider, pageCount, total)` reverses the total into **extraction**
  (per-page OCR estimate) and **structuring** (the remainder from LLM tokens) for
  display. The API derives this split on the fly from the stored total, so no
  schema migration was needed to add the breakdown.
- Display converts USD → INR (`× 83`) and renders ₹; local Ollama is **Free**.

### 4.6 Cancellation

`extraction/cancel.ts` keeps an in-memory `Map<invoiceId, AbortController>`
(single-process; signals do not cross replicas):

- `startCancellable` / `finishCancellable` register and clear controllers.
- `requestCancel(invoiceId)` aborts the controller; the cancel endpoint sets
  status to `FAILED`/"Cancelled by user".
- The abort signal is threaded into provider calls (e.g. Ollama composes
  `AbortSignal.any([userCancel, timeout])`). The finish path checks
  `signal.aborted` to avoid a race where a result lands just as the user cancels.

### 4.7 Bake-off

`bakeoffInvoice(invoiceId)` runs **every configured provider** against the same
PDF, each producing its own `ExtractionRun` (without changing the active result).
The UI shows a card per run (confidence, cost, latency, accuracy bars); choosing
one calls `apply-run`, which copies that run's `fieldsSnapshot`/`itemsSnapshot`
back onto the invoice.

---

## 5. Providers

Registered statically in `providers/registry.ts`:
`mistral, azure, llamaparse, textract, google, ollama`.

Each implements the `ExtractionProvider` contract (`providers/types.ts`):

```ts
{
  name; displayName;
  kind: 'markdown' | 'structured';
  requiredCredentials: string[];
  isConfigured(creds): boolean;
  extract(file, creds, ctx): Promise<CanonicalResult>;
}
```

| Provider | Kind | Credentials | How it works |
|----------|------|-------------|--------------|
| **Ollama (GLM-OCR)** | markdown | `baseUrl`, `model` | **Local, default, free.** Two-pass: (1) header pass rasterizes the top ~4 in of page 1; (2) full-page pass rasterizes up to 5 pages at 150 dpi, one OCR request per page. Markdown then sent to the structuring LLM. Greedy (`temperature 0`) for reproducibility; ~190 s/page, 300 s timeout. |
| **Mistral OCR** | markdown | `apiKey` | Base64 PDF → `POST api.mistral.ai/v1/ocr` (`mistral-ocr-latest`), join per-page markdown → structuring LLM. |
| **LlamaParse** | markdown | `apiKey` | Multipart upload → poll job → fetch `/result/markdown` → structuring LLM. |
| **Azure Document Intelligence** | structured | `endpoint`, `apiKey` (+`apiVersion`, default `2024-11-30`) | `prebuilt-invoice` model; submit PDF, poll `operation-location`, map fields directly. **No LLM pass.** |
| **AWS Textract** | structured | `accessKeyId`, `secretAccessKey`, `region` | `AnalyzeExpenseCommand` via AWS SDK; map summary + line-item fields directly. **No LLM pass.** |
| **Google Document AI** | structured | `projectId`, `location`, `processorId`, `keyJson` | **Stub** — throws "not implemented". |

PDF rendering for the local path uses `pdftoppm` (poppler) in `lib/rasterize.ts`:
`rasterizePdf` (full pages → base64 PNGs) and `rasterizeTopBand` (cropped header).

### Reference table (`providers/reference.ts`)

Per-provider benchmarks used for cost estimation and the bake-off display
(USD per 1 000 pages, representative accuracy):

| Provider | $/1k pages | header acc | line acc | pattern |
|----------|-----------:|-----------:|---------:|---------|
| ollama | 0 | 0.85 | 0.80 | local OCR→md + LLM |
| mistral | 2 | 0.90 | 0.85 | OCR→md + LLM |
| llamaparse | 9 | 0.90 | 0.85 | OCR→md + LLM |
| azure | 10 | 0.93 | 0.87 | prebuilt invoice |
| textract | 10 | 0.78 | 0.82 | structured fields |
| google | 20 | 0.40 | 0.40 | structured fields |

---

## 6. The structuring pass (markdown → canonical JSON)

For **markdown** providers, OCR text is converted to the canonical schema by a
second LLM call. `structuring/index.ts` selects the model from settings:

```
provider = setting('structuring_provider', default 'ollama')
model    = setting('structuring_model',    default 'qwen2.5:3b')
creds    = creds('structuring_<provider>') ?? creds('<provider>') ?? {}
```

The prompt (`structuring/types.ts`) instructs the model to emit **only minified
JSON** matching the canonical shape — dates as `YYYY-MM-DD`, numbers without
currency symbols, `null` for unknowns, a `confidence` in 0..1, and no prose/code
fences. `normalizeStructured()` then defensively extracts the JSON (first `{` to
last `}`), coerces strings/numbers/dates, and 1-indexes line items.

| Structuring provider | Transport | Token usage source |
|----------------------|-----------|--------------------|
| **anthropic** | `@anthropic-ai/sdk`, max 4096 tokens | `usage.input_tokens` / `output_tokens` |
| **openai** | `openai` SDK, system+user messages | `usage.prompt_tokens` / `completion_tokens` |
| **mistral** | raw `fetch` to `/v1/chat/completions` | `usage.prompt_tokens` / `completion_tokens` |
| **ollama** | `ollamaChat`, `json:true`, `temperature 0` | none → cost 0 |

The Ollama structuring path sizes its context window dynamically
(`numCtx = clamp(⌈prompt.length/2⌉ + 4096, 8192, 32768)`) because Ollama
**silently truncates** input that overflows `num_ctx`, and uses greedy decoding
so structuring is deterministic run-to-run.

### Pricing (`structuring/pricing.ts`)

`structuringTokenCost(model, inTok, outTok) = (inTok·in + outTok·out)/1e6`, USD
per **1 M tokens**:

| Model | input $/1M | output $/1M |
|-------|-----------:|------------:|
| mistral-large-latest | 2.0 | 6.0 |
| mistral-small-latest | 0.2 | 0.6 |
| gpt-4o | 2.5 | 10.0 |
| gpt-4o-mini | 0.15 | 0.6 |
| claude-sonnet-4-6 | 3.0 | 15.0 |

Unknown/local models return 0 (never inflate totals). Structuring can cost
several × the OCR step — which is exactly why the cost breakdown was split out.

---

## 7. HTTP API

Fastify app (`app.ts`): `logger:false`, CORS `origin:true`, multipart limits
**50 MB/file, 50 files/request**, listens on `0.0.0.0:${PORT}` (default 4000).
Routes registered: `config, invoices, export, analytics, settings`.

### Invoices

| Method · Path | Purpose |
|---------------|---------|
| `POST /api/invoices/upload` | Multipart upload (≤50 files). Returns `{ created, duplicates, rejected }`. |
| `GET /api/invoices` | List with filters `status, q, minTotal, dateFrom, dateTo, sort, dir`. Adds `itemCount`, `costEstimate`. |
| `GET /api/invoices/:id` | One invoice with `lineItems`, `runs`, and the extraction/structuring cost split. |
| `PATCH /api/invoices/:id` | Edit header + line items; sets `verified=true`, `editedAt`. |
| `POST /api/invoices/:id/reextract` | Re-run (optional `{provider}`). |
| `POST /api/invoices/:id/cancel` | Abort in-flight extraction. |
| `POST /api/invoices/:id/bakeoff` | Run all configured providers → `{runs}`. |
| `POST /api/invoices/:id/apply-run` | Apply a past run `{runId}`. |
| `POST /api/invoices/bulk` | `{action: 'reextract'|'delete', ids}`. |
| `DELETE /api/invoices/:id` | Delete one invoice (cascades line items + runs). |

### Settings · Config · Analytics · Export

| Method · Path | Purpose |
|---------------|---------|
| `GET /api/settings` | Selections + provider list with **masked** credential hints. |
| `GET /api/settings/reveal` | **Decrypted** credentials (single-tenant convenience — see §9). |
| `PUT /api/settings` | Update `extractionProvider`/`structuringProvider`/`structuringModel`. |
| `PUT /api/settings/providers/:provider` | Set/merge provider credentials. |
| `DELETE /api/settings/providers/:provider` | Clear provider credentials. |
| `GET /api/config` | Read-only provider availability + active selections (used by the SPA on load). |
| `GET /api/analytics` | `totalSpend, completedCount, avgConfidence, needsReview, byVendor (top 8), byMonth`. |
| `GET /api/invoices/export/csv` | Ledger CSV (honours list filters). |
| `GET /api/invoices/export/line-items.csv` | Line-items CSV. |

---

## 8. Frontend

React 18 + Vite + React Router 6. No component library — styling is a centralized
inline-style theme (`theme.ts`: warm neutral palette, indigo `#4f46e5` accent,
Hanken Grotesk / Geist Mono). Built with `tsc --noEmit && vite build`, served by
nginx with SPA fallback to `index.html`. In dev, Vite proxies `/api` →
`VITE_API_BASE ?? http://localhost:4000`.

### Routes & pages

| Route | Page | Responsibility | Key endpoints |
|-------|------|----------------|---------------|
| `/` → `/invoices` | redirect | — | — |
| `/invoices` | **InvoicesPage** | Drag-drop upload, filter/search/sort table, multi-select bulk actions, CSV export, status polling. | `config`, `invoices` (list), `upload`, `bulk`, `cancel`, `export/*` |
| `/invoices/:id` | **InvoiceDetailPage** | Field view, inline edit + verify, re-extract w/ provider picker, bake-off & compare overlays, raw-OCR toggle. | `get`, `config`, `reextract`, `patch`, `del`, `bakeoff`, `apply-run` |
| `/analytics` | **AnalyticsPage** | KPI cards + top-vendors / spend-by-month bar charts. | `analytics` |
| `/settings` | **SettingsPage** | Provider credentials, active provider, structuring model (with autocomplete). | `settings`, `reveal`, `saveSettings`, `saveCreds`, `clearCreds` |

The API client (`api.ts`) is a thin typed wrapper over `fetch` that throws on
non-OK responses (surfacing the server's `error` field). Polling
(`hooks/usePolling.ts`) ticks every 3 s while a predicate holds and stops when all
invoices reach a terminal state. Shared components: `Shell` (sidebar layout),
`StatusDot` (pulsing badge), `ConfidenceBar`, `Toast`; overlays `BakeoffOverlay`
and `CompareOverlay`.

### Representative workflows

- **Upload:** filter to PDFs → `POST upload` → show duplicates banner → poll until
  status settles.
- **Re-extract:** pick provider → `POST reextract` → poll → toast on complete.
- **Bake-off:** `POST bakeoff` (all providers concurrently) → compare run cards →
  "Use this engine" → `apply-run` → reload.
- **Edit & verify:** edit fields/line items → `PATCH` (sets `verified=true`) →
  exit edit mode.

---

## 9. Security model

- **Credential encryption.** Provider keys are stored in
  `ProviderConfig.credentialsEnc` as AES-256-GCM (`lib/crypto.ts`): the key is
  `SHA-256(APP_SECRET)` (32 bytes); each blob is `iv.tag.ciphertext` (base64,
  12-byte IV, 16-byte auth tag). `GET /api/settings` returns only masked hints
  (e.g. `••••abcd`).
- **`APP_SECRET` stability is critical.** If it changes between runs, previously
  saved credentials can no longer be decrypted and appear as "not configured".
  Set it **once** in `.env` (Docker Compose loads it automatically); the
  weak default `dev-secret-change-me` warns at startup and must be replaced
  before exposing the service.
- **`/api/settings/reveal` returns plaintext** so the Settings UI can repopulate
  fields. This is safe **only** because v1 is single-tenant with **no auth** — if
  authentication is added, this endpoint must be gated.
- **No authentication / single-tenant.** Deploy on trusted/internal infrastructure
  only. Auth is on the roadmap.

---

## 10. Configuration & deployment

### Docker Compose (`docker-compose.yml`)

Three services — `db` (Postgres 16, healthchecked), `api` (built from
`api/Dockerfile`, waits for db health, runs `prisma migrate deploy` then
`node dist/index.js`, port 4000), and `web` (nginx serving the built SPA, port
8080→80). Volumes: `pgdata`, `uploads`.

```bash
cp .env.example .env          # set a strong, STABLE APP_SECRET
docker compose up --build
# Web UI  → http://localhost:8080
# API     → http://localhost:4000
```

### Boot sequence (`api/src/index.ts`)

1. Warn if `APP_SECRET` is the dev default.
2. Ensure the upload directory exists.
3. `seedFromEnv()` — seed settings + provider credentials from env vars **only if
   not already in the DB** (DB always wins after first boot).
4. Build Fastify app, listen on `0.0.0.0:PORT`.

### Defaults & seeding

Ships **fully local** (`settings/defaults.ts`):
`extraction_provider=ollama`, `structuring_provider=ollama`,
`structuring_model=qwen2.5:3b`, Ollama at `http://host.docker.internal:11434`
with OCR model `glm-ocr`. `seedFromEnv` reads `EXTRACTION_PROVIDER`,
`STRUCTURING_MODEL_PROVIDER`, `STRUCTURING_MODEL`, `OLLAMA_*`, and the various
`*_API_KEY` / Azure vars, encrypting any provided keys before insert.

### Key environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | Postgres connection string |
| `APP_SECRET` | yes | AES-256-GCM key material for credential encryption |
| `UPLOAD_DIR` | no | PDF storage dir (default `./uploads`) |
| `PORT` | no | API port (default 4000) |
| `EXTRACTION_PROVIDER` | no | Seed active extraction provider (default `ollama`) |
| `STRUCTURING_MODEL_PROVIDER` / `STRUCTURING_MODEL` | no | Seed structuring provider/model |
| `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | no | Seed local Ollama URL / OCR model |
| `MISTRAL_API_KEY`, `AZURE_DI_ENDPOINT`/`AZURE_DI_KEY`, `LLAMAPARSE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | no | Seed provider credentials |

Seed values apply only when no matching DB setting exists; the Settings UI takes
precedence thereafter.

---

## 11. Testing

- **API** — Vitest against a live Postgres (routes, extraction, providers,
  structuring, pricing, crypto, csv). Requires the DB running.
- **Web** — Vitest + jsdom (pages, overlays, formatting, polling); no network.

```bash
cd api && npm test     # backend (needs Postgres)
cd web && npm test     # frontend
```

---

## 12. Design decisions & rationale

- **One canonical schema, two pipeline shapes.** Markdown vs structured providers
  converge on the same `CanonicalResult`, keeping storage/UI/export
  provider-agnostic and making new providers cheap to add.
- **Run snapshots over re-extraction.** `ExtractionRun.fieldsSnapshot/itemsSnapshot`
  let the bake-off and history features apply any prior result instantly without
  hitting a provider again.
- **Cost split derived, not stored.** The extraction/structuring breakdown is
  computed on the fly from the stored total (`splitCost`), so the feature shipped
  without a schema migration.
- **Local-first defaults.** The app runs end-to-end with no cloud keys (Ollama OCR
  + Ollama structuring), which is free and private; cloud providers are opt-in via
  Settings.
- **Determinism for local structuring.** `temperature 0` + dynamic `num_ctx`
  sizing avoid Ollama's silent truncation and run-to-run variance.
- **Encryption keyed from a single secret.** Simple AES-256-GCM with
  `SHA-256(APP_SECRET)`; the trade-off is that rotating `APP_SECRET` invalidates
  stored credentials (documented prominently).

---

## 13. Repository map

```
api/
  prisma/schema.prisma          data model + migrations
  src/
    index.ts  app.ts  env.ts  db.ts        bootstrap / Fastify / config / Prisma
    routes/    invoices · settings · config · analytics · export
    extraction/  run.ts · cancel.ts · confidence.ts
    providers/   types · registry · reference · ollama · mistral · azure ·
                 llamaparse · textract · google
    structuring/ index · types · pricing · anthropic · openai · mistral · ollama
    settings/    store · defaults · seed
    lib/         crypto · csv · hash · http · pdf · rasterize · ollama
  tests/        Vitest (routes, extraction, providers, structuring, lib)
web/
  src/
    main.tsx  App.tsx  api.ts  types.ts  theme.ts  format.ts
    pages/       InvoicesPage · InvoiceDetailPage · AnalyticsPage · SettingsPage
    overlays/    BakeoffOverlay · CompareOverlay
    components/  Shell · StatusDot · ConfidenceBar · Toast
    hooks/       usePolling
  Dockerfile  nginx.conf  vite.config.ts
docker-compose.yml   README.md
```
```
