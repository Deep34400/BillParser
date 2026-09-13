# BillParser — Fleet Invoice OCR SaaS

SaaS platform for extracting structured data from automotive invoices (PDF/image), with approval workflows, analytics, and fraud detection.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Frontend (React 18)                        │
│   Tailwind CSS + shadcn/ui · Lucide Icons · Vite 5 · TypeScript    │
├──────────────────────────────────────────────────────────────────────┤
│                          API (Fastify 5)                            │
│   JWT + API Key Auth → Controller → Service                         │
├──────────────────────────────────────────────────────────────────────┤
│                        Business Logic                               │
│   OCR Pipeline · Invoice Service · Audit · Webhooks · Export        │
├──────────────────────────────────────────────────────────────────────┤
│                        Data Layer                                   │
│   PostgreSQL + Sequelize 6 · Google Cloud Storage                   │
├──────────────────────────────────────────────────────────────────────┤
│                       OCR Providers                                 │
│   Mistral OCR · Gemini (Vertex AI) · Claude · OpenAI · AzAPI       │
└──────────────────────────────────────────────────────────────────────┘
```

## Key Features

| Feature | Description |
|---------|-------------|
| **Multi-Provider OCR** | Fallback chain tries multiple AI providers; reconciliation picks the best result |
| **Auth** | JWT + API keys; admin vs regular user |
| **Indian GST** | Seller/buyer GSTIN correction, PAN derivation, intra/inter-state tax handling |
| **Fraud Detection** | Duplicate invoices, GST anomalies, price outliers, odometer rollback |
| **Analytics** | Spend by workshop/vehicle/month, cost-per-km, OCR API cost tracking |
| **Token Billing** | Per-user token balance with atomic debit, audit trail |
| **Email Intake** | IMAP polling for invoices sent via email |
| **Audit history** | Every upload, OCR result, approval, and admin action on Account / Admin |
| **Webhooks** | Signed HTTPS POSTs when invoices are uploaded, completed, approved, or deleted |
| **Modern UI** | Tailwind CSS + shadcn/ui components, Lucide icons, responsive layout |

## Docs

| Doc | What it covers |
|-----|----------------|
| [platform/ARCHITECTURE.md](platform/ARCHITECTURE.md) | System overview, API list, deployment |
| [platform/DATABASE.md](platform/DATABASE.md) | All tables (including audit_logs, webhook_endpoints), FKs, indexes |
| [platform/src/audit/README.md](platform/src/audit/README.md) | Activity history (how it is written and shown) |
| [platform/src/webhook/README.md](platform/src/webhook/README.md) | Outbound webhooks + HMAC verification |
| [platform/src/ocr/README.md](platform/src/ocr/README.md) | OCR pipeline (how the code runs) |
| [platform/src/users/README.md](platform/src/users/README.md) | Auth, API keys, token billing |
| [platform/src/vendor/README.md](platform/src/vendor/README.md) | Vendor matching |
| [platform/src/analytics/README.md](platform/src/analytics/README.md) | KPIs and spend |
| [platform/src/fraud/README.md](platform/src/fraud/README.md) | Anomaly checks |
| [platform/src/email-intake/README.md](platform/src/email-intake/README.md) | Email-based invoice ingestion |
| [web/ARCHITECTURE.md](web/ARCHITECTURE.md) | React UI with Tailwind + shadcn/ui |

## Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20 + TypeScript |
| API | Fastify 5 |
| Database | PostgreSQL 15+ · Sequelize 6 |
| Storage | Google Cloud Storage |
| OCR / AI | Mistral OCR · Gemini (Vertex AI) · Claude · OpenAI · AzAPI |
| Frontend | React 18 · Tailwind CSS v4 · shadcn/ui · Lucide React · Vite 5 |
| Tests | Vitest |
| Deploy | Docker · Cloud Run · Cloud SQL |

## Quick Start

```bash
# PostgreSQL must be running (DATABASE_URL in platform/.env)

# Terminal 1 — API
cd platform && npm install && npm run dev    # :4000

# Terminal 2 — UI
cd web && npm install && npm run dev         # :5173
```

Vite proxies `/api/*` to `:4000`. Default login: `admin@praya.io` (password from `ADMIN_PASSWORD` or `admin123` in non-prod).

```bash
# Docker (API :4000, web :8081)
docker compose up --build

# Tests
cd platform && npm test
cd web && npm test
```

## Project Structure

```
├── platform/                # Backend API
│   └── src/
│       ├── config/          # Database, env, GCS
│       ├── db/              # Schema init + migrations
│       ├── middleware/       # Auth, error handler, rate limit
│       ├── ocr/             # OCR pipeline + invoice CRUD
│       │   ├── models/      # Bill, BillPart Sequelize models
│       │   ├── pipeline/    # Single, Split, FallbackChain
│       │   ├── providers/   # Gemini, Mistral, Claude, OpenAI
│       │   ├── parser/      # JSON repair + structuring
│       │   ├── transformer/ # Normalize, validate, review
│       │   └── service/     # InvoiceService, ExportService
│       ├── users/           # Auth, API keys, token billing
│       ├── vendor/          # Vendor matching
│       ├── analytics/       # Spend KPIs
│       ├── fraud/           # Anomaly detection
│       ├── email-intake/    # IMAP poller
│       ├── audit/           # Activity history
│       ├── webhook/         # Signed outbound events
│       ├── odometerOcr/     # Standalone odometer OCR
│       ├── shared/          # Types, constants, errors, settings
│       │   └── errors.ts    # AppError hierarchy
│       ├── routes/          # Settings + config
│       ├── app.ts           # Fastify app factory
│       └── index.ts         # Boot: init DB, seed admin, listen
│
├── web/                     # Frontend SPA
│   └── src/
│       ├── components/      # Reusable components
│       │   └── ui/          # shadcn/ui primitives (Button, Card, Badge, etc.)
│       ├── pages/           # Route-level pages
│       ├── api/             # HTTP client
│       ├── hooks/           # usePolling
│       ├── lib/             # Utilities (format, cn, balance)
│       ├── overlays/        # Modals (Compare, Bakeoff)
│       ├── styles/          # globals.css (Tailwind config)
│       └── types/           # Shared TypeScript interfaces
│
└── openspec/                # Feature specs
```
