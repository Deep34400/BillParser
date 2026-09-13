# BillParser Platform — Architecture

Index for how the backend is wired. Table columns live in [DATABASE.md](./DATABASE.md). Module internals live in each domain README.

| Topic | Doc |
|-------|-----|
| Tables, FKs, indexes | [DATABASE.md](./DATABASE.md) |
| OCR pipeline | [src/ocr/README.md](./src/ocr/README.md) |
| OCR cost math | [src/ocr/COST.md](./src/ocr/COST.md) |
| Auth / tokens | [src/users/README.md](./src/users/README.md) |
| Vendor registry | [src/vendor/README.md](./src/vendor/README.md) |
| Analytics | [src/analytics/README.md](./src/analytics/README.md) |
| Fraud | [src/fraud/README.md](./src/fraud/README.md) |
| Email intake | [src/email-intake/README.md](./src/email-intake/README.md) |
| Audit history | [src/audit/README.md](./src/audit/README.md) |
| Webhooks | [src/webhook/README.md](./src/webhook/README.md) |
| Frontend | [../web/ARCHITECTURE.md](../web/ARCHITECTURE.md) |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20 + TypeScript |
| API | Fastify 5 |
| Database | PostgreSQL + Sequelize 6 |
| Files | Google Cloud Storage |
| OCR / AI | Mistral OCR, Gemini / Claude / OpenAI |
| Frontend | React 18 + Vite |
| Tests | Vitest |
| Deploy | Docker + Cloud Run + Cloud SQL |

---

## Project Structure

```
platform/src/
├── config/          # db.ts (Sequelize + NUMERIC parser), env.ts, gcs.ts
├── db/              # schema.ts (initModels + associations), migrate.ts
├── middleware/
│   ├── auth.ts            # JWT + API key authentication
│   ├── rateLimit.ts       # Per-user 60 req/min
│   └── errorHandler.ts   # Global Fastify error handler (AppError → HTTP)
├── ocr/             # pipeline, providers, parser, transformer, models, repo
│   ├── route.ts           # Thin HTTP controller (338 lines)
│   └── service/           # Business logic
│       ├── invoiceService.ts  # All invoice operations (388 lines)
│       └── exportService.ts   # CSV export logic
├── users/           # auth, API keys, token ledger
├── vendor/          # vendor upsert from invoices
├── analytics/       # spend / cost KPIs
├── fraud/           # duplicate, GST, price, odometer checks
├── email-intake/    # IMAP → DRAFT bills
├── audit/           # append-only activity log
├── webhook/         # outbound signed POSTs
├── odometerOcr/     # standalone odometer extract
├── shared/
│   ├── constants.ts       # Bill types, OCR statuses
│   ├── errors.ts          # AppError hierarchy (NotFound, Validation, Forbidden, etc.)
│   ├── settings.ts        # Pipeline settings
│   ├── storage.ts         # GCS upload/download
│   ├── cache.ts           # Analytics cache
│   └── types.ts           # BillDoc, ParsedInvoiceData, etc.
├── routes/          # settings + config
├── app.ts           # Fastify factory (auth → errorHandler → routes)
└── index.ts         # init DB, seed admin, listen
```

Models live in `{domain}/models/`. `db/schema.ts` is the only place that calls `initModels()` and sets associations.

---

## Database Layer (code)

- **`config/db.ts`** — singleton Sequelize from `DATABASE_URL`. Pool `max: 2` (Cloud Run). `pg` OID 1700 parser so NUMERIC is a JS number.
- **`db/schema.ts`** — init order: Vendor → User → Bill → BillPart → ApiKey → TokenTransaction → AppSettings → ProviderCredential → AuditLog → WebhookEndpoint. Associations: Bill↔Vendor, Bill↔BillPart, User↔ApiKey, User↔TokenTransaction.
- **`db/migrate.ts`** — drops retired org tables, then `CREATE EXTENSION pg_trgm` + `sync({ alter: true })`.
- **`shared/constants.ts`** — bill types, OCR statuses, pagination, pricing defaults.

Route → Service → Repository → Sequelize model → PostgreSQL. Repositories map camelCase rows ↔ snake_case domain docs (`BillDoc`, `UserDoc`).

## Request Lifecycle

```
HTTP Request
  → authPlugin          (JWT/API key → req.appUser)
  → route handler        (thin controller — parse request, call service)
  → service layer        (business logic, validation)
  → repository           (Sequelize CRUD)
  → global errorHandler  (AppError → structured JSON response)
```

## Error Handling

Custom error classes in `shared/errors.ts`:

| Error Class | HTTP Status | Usage |
|-------------|-------------|-------|
| `NotFoundError` | 404 | Resource not found |
| `ValidationError` | 400 | Invalid input |
| `AuthenticationError` | 401 | Not logged in |
| `ForbiddenError` | 403 | Insufficient permissions |
| `InsufficientBalanceError` | 402 | Token balance too low |
| `UnsupportedFileError` | 415 | Not a valid PDF/image |
| `PipelineError` | 500 | OCR pipeline failure |

The global error handler (`middleware/errorHandler.ts`) catches all errors and returns `{ success: false, message }` with the appropriate HTTP status.

Full column list: [DATABASE.md](./DATABASE.md).

---

## End-to-End Upload Flow

```
POST /api/invoices/upload
  → validate PDF/image
  → shared/storage.ts → GCS
  → createBill(PROCESSING)
  → return 202 + bill_id immediately

Background:
  runPipeline() → fallbackChain (single or split)
  parser + enrichParsedInvoice + reconcileTotal
  mapParsedToBill → updateBill (OCR_COMPLETED | NEED_REVIEW | FAILED)
  saveBillParts
  upsertVendorFromInvoice (fire-and-forget)
  deductTokens (if user session)
```

Frontend polls `GET /api/invoices`. Detail page uses `GET /api/invoices/:id`.

| Status | Meaning |
|--------|---------|
| `UPLOADED` | File stored, OCR not started |
| `PROCESSING` | Pipeline running |
| `OCR_COMPLETED` | Parsed, reconciliation OK |
| `NEED_REVIEW` | Parsed with review flags |
| `VERIFIED` | Human confirmed |
| `FAILED` | Pipeline error |
| `DRAFT` | Email-ingested, waiting for Process OCR |

Pipeline internals: [src/ocr/README.md](./src/ocr/README.md).

---

## Settings

Stored in `app_settings` (singleton id=1) and `provider_credentials`.

1. Settings UI → `PUT /api/settings` (fallback chain, pricing, FX)
2. Credentials → `PUT /api/settings/providers/:name`
3. Next OCR run reads `getSettings()` + `resolveKey()`

Gemini on Cloud Run uses Vertex + ADC (no `GEMINI_API_KEY`).

---

## API Reference

### Bills / OCR

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/invoices` | Paginated list |
| `GET` | `/api/invoices/counts` | Status counts |
| `GET` | `/api/invoices/:id` | Detail + parts |
| `GET` | `/api/invoices/:id/file` | PDF/image |
| `POST` | `/api/invoices/upload` | Upload (async OCR) |
| `POST` | `/api/invoices/import` | Import from URLs |
| `POST` | `/api/invoices/:id/reextract` | Re-run OCR |
| `POST` | `/api/invoices/:id/cancel` | Cancel |
| `POST` | `/api/invoices/:id/process-ocr` | OCR a DRAFT |
| `PATCH` | `/api/invoices/:id` | Human edit |
| `DELETE` | `/api/invoices/:id` | Delete bill + parts |
| `POST` | `/api/invoices/bulk` | Bulk actions |
| `POST` | `/api/invoices/reconcile-range` | Batch reconcile |
| `GET` | `/api/invoices/export/csv` | Bills CSV |
| `GET` | `/api/invoices/export/line-items.csv` | Line items CSV |
| `POST` | `/api/parse` | Stateless parse |
| `POST` | `/api/ocr/sync` | Sync OCR (API key) |
| `POST` | `/api/ocr/async` | Async OCR (API key) |

### Auth / Account / Admin

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/api/auth/login` | Public |
| `GET/POST/DELETE` | `/api/auth/api-keys` | JWT |
| `GET` | `/api/account` | JWT / key |
| `GET` | `/api/account/transactions` | JWT / key |
| `GET` | `/api/audit/logs` | JWT (own rows; admin sees all) |
| `GET/POST/PATCH/DELETE` | `/api/webhooks` | JWT |
| `GET/POST` | `/api/admin/users` | Admin |
| `PATCH` | `/api/admin/users/:id/block` | Admin |
| `POST` | `/api/admin/users/:id/tokens` | Admin |

### Other

| Area | Paths |
|------|-------|
| Vendors | `GET /api/vendors`, `GET /api/vendors/:id` |
| Analytics | `/api/analytics/kpis`, `/workshops`, `/vehicles`, `/months`, `/costkm`, `/costs` |
| Fraud | `/api/fraud/scan`, `/duplicates`, `/gst-anomalies`, `/price-anomalies`, `/odometer`, `/summary` |
| Settings | `/api/settings`, `/api/settings/providers/:name`, `/api/config` |
| Odometer | `POST /api/odometer/extract`, `POST /api/odometer/batch` |
| Health | `GET /api/health` |

### Activity & webhooks

| Area | Where in the UI | How it works |
|------|-----------------|--------------|
| My webhooks | **Account → Webhooks** | Store URL + events in `webhook_endpoints`. Invoice service POSTs a signed JSON body when that user uploads / completes / fails / approves / rejects / deletes a bill. |
| My activity | **Account → My activity** | `GET /api/audit/logs` scoped to the current user. |
| All activity | **Admin → Activity** | Same API; admins see every user. |

Full write-up: [src/audit/README.md](./src/audit/README.md) and [src/webhook/README.md](./src/webhook/README.md).

---

## Local Development

Always PostgreSQL — no in-memory DB.

```bash
# Terminal 1
cd platform
# DATABASE_URL=postgresql://billparser_app_dev:local_dev_password@localhost:5432/billparser_dev
npm install && npm run dev    # http://localhost:4000

# Terminal 2
cd web
npm install && npm run dev    # http://localhost:5173
```

Or `docker compose up --build` (API :4000, web :8081).

First boot seeds admin (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, default `admin@praya.io` / `admin123` in non-prod).

```bash
cd platform && npm test
cd web && npm test
```

---

## Deployment

Cloud Run + Cloud SQL + GCS. Do not set `GEMINI_API_KEY` in prod (Vertex ADC).

Required env: `DATABASE_URL`, `GCP_PROJECT_ID`, `STORAGE_BUCKET`, `JWT_SECRET`, `ADMIN_PASSWORD`, `MISTRAL_API_KEY`, `NODE_ENV=production`.

| Aspect | Local | Production |
|--------|-------|------------|
| Database | Local / Docker Postgres | Cloud SQL |
| Files | GCS via ADC | GCS production bucket |
| Gemini | ADC or API key | Vertex + ADC |
| Admin seed | Default password allowed | Secret Manager only |

---

## OCR Response Contract (`parsed_data`)

Do not rename fields. Consumed by UI, analytics, and fraud.

```json
{
  "gstin": "07AAGCJ6656E1ZF",
  "company_name": "JSB MOBILITY PVT LTD",
  "invoice_number": "DW21S25103620",
  "invoice_date": "19.03.2026",
  "vehicle_details": { "registration_number": "HR55AM4015", "mileage_odometer_reading": 62341 },
  "parts_line_items": [{ "item_name_description": "...", "quantity": 1, "rate": 423.73, "taxable_amount": 423.73, "tax_percentage": 18 }],
  "labour_service_line_items": [{ "labour_description": "...", "labour_charges": 2700, "tax_percentage": 18 }],
  "totals_and_tax_summary": {
    "parts_total": 3527.12,
    "labour_total": 3965,
    "grand_total_invoice": 8691
  },
  "confidence": 0.92
}
```
