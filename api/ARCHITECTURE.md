# API Architecture

Production-level Node.js/TypeScript backend for invoice OCR, parsing, and bill analysis.

## Folder Structure

```
api/
├── prisma/                    # Database schema & migrations
│   ├── schema.prisma
│   └── migrations/
├── scripts/                   # CLI tooling & diagnostics
│   ├── check-db.ts            # Verifies all DB invoices reconcile
│   ├── check-bills.ts         # Verifies markdown bill files
│   └── diag-tax.ts            # Quick tax-diagnostic dump
├── src/
│   ├── index.ts               # Server entry point
│   ├── app.ts                 # Fastify app builder (registers all routes)
│   │
│   ├── config/                # App configuration
│   │   ├── db.ts              # Prisma client singleton
│   │   └── env.ts             # Environment variable parsing
│   │
│   ├── routes/                # HTTP route handlers (thin controllers)
│   │   ├── invoices.ts        # CRUD + upload + re-extract
│   │   ├── parse.ts           # POST /api/parse (stateless)
│   │   ├── batches.ts         # Batch management
│   │   ├── export.ts          # CSV export
│   │   ├── analytics.ts       # Dashboard KPIs
│   │   ├── config.ts          # Provider config endpoint
│   │   └── settings.ts        # Settings CRUD + credential mgmt
│   │
│   ├── extraction/            # OCR extraction pipeline
│   │   ├── run.ts             # Orchestrates: provider → structure → store
│   │   ├── parseOnce.ts       # Stateless single-PDF extraction
│   │   ├── ingest.ts          # File intake + batch grouping
│   │   ├── confidence.ts      # Confidence scoring + cost estimation
│   │   └── cancel.ts          # Cancellation token management
│   │
│   ├── providers/             # OCR providers (PDF → markdown)
│   │   ├── registry.ts        # Provider registry + lookup
│   │   ├── types.ts           # Shared CanonicalResult, ExtractionProvider
│   │   ├── reference.ts       # Reference costs per provider
│   │   ├── azure.ts           # Azure Document Intelligence
│   │   ├── gemini.ts          # Google Gemini Vision
│   │   ├── google.ts          # Google Document AI
│   │   ├── mistral.ts         # Mistral OCR
│   │   ├── ollama.ts          # Local Ollama (GLM-OCR)
│   │   ├── llamaparse.ts      # LlamaParse
│   │   ├── textract.ts        # AWS Textract
│   │   └── clients/           # Provider SDK wrappers
│   │       ├── gemini.ts      # @google/generative-ai wrapper
│   │       └── ollama.ts      # Ollama HTTP client
│   │
│   ├── structuring/           # LLM structuring (markdown → JSON)
│   │   ├── index.ts           # Model registry + enrichment pipeline
│   │   ├── types.ts           # StructuringModel interface
│   │   ├── pricing.ts         # Token cost calculator
│   │   ├── anthropic.ts       # Claude
│   │   ├── openai.ts          # GPT
│   │   ├── gemini.ts          # Gemini
│   │   ├── mistral.ts         # Mistral
│   │   └── ollama.ts          # Local Ollama
│   │
│   ├── parsing/               # LLM output → validated structured data
│   │   ├── index.ts           # Barrel exports + structureFromLlmResponse
│   │   ├── types.ts           # ParsedInvoiceData, line item types
│   │   ├── prompt.ts          # OCR + structuring prompt templates
│   │   ├── parse.ts           # JSON extraction + schema detection
│   │   ├── coerce.ts          # Type coercion (toNum, toStr, etc.)
│   │   ├── validate.ts        # Business rule validation
│   │   └── legacy.ts          # Legacy canonical format support
│   │
│   ├── billing/               # Bill math, footer extraction, normalization
│   │   ├── footerExtract.ts   # Deterministic footer parsing from OCR markdown
│   │   ├── footerSupplement.ts# Gemini-based footer gap-filling
│   │   ├── billSummary.ts     # Bill summary reconciliation (GST, dedup)
│   │   ├── normalize.ts       # Post-parse enrichment pipeline
│   │   └── dateExtract.ts     # Invoice date fallback from OCR
│   │
│   ├── response/              # API response shaping
│   │   ├── apiResponse.ts     # toApiParsed — shapes parsed data for API
│   │   └── toCanonical.ts     # ParsedInvoiceData → CanonicalResult
│   │
│   ├── settings/              # Application settings & credentials
│   │   ├── defaults.ts        # Default config values
│   │   ├── store.ts           # DB-backed get/set for settings + creds
│   │   ├── seed.ts            # Initial seeding from environment
│   │   └── migrate.ts         # Deprecated settings migration
│   │
│   └── lib/                   # Pure utilities (no business logic)
│       ├── crypto.ts          # AES encrypt/decrypt for credentials
│       ├── csv.ts             # Array → CSV string
│       ├── fetchSource.ts     # File/URL → Buffer resolver
│       ├── hash.ts            # SHA-256 hashing
│       ├── http.ts            # HTTP error body parser
│       ├── pdf.ts             # PDF detection + page counting
│       └── rasterize.ts       # PDF → image rasterization
│
├── tests/                     # Mirrors src/ structure
│   ├── billing/               # Footer extraction, bill math, normalization
│   ├── parsing/               # JSON parse, canonical, validation
│   ├── extraction/            # Extraction pipeline tests
│   ├── providers/             # Provider + SDK client tests
│   │   └── clients/
│   ├── routes/                # HTTP endpoint integration tests
│   ├── settings/              # Settings store/seed/migration tests
│   ├── structuring/           # LLM structuring tests
│   ├── lib/                   # Pure utility tests
│   └── globalSetup.ts         # Test DB setup
│
├── vitest.config.ts           # Full test config (with DB)
├── vitest.schema.config.ts    # Pure-logic tests only (billing + parsing)
├── tsconfig.json
├── package.json
└── Dockerfile
```

## Data Flow

```
PDF Upload/URL
     │
     ▼
  extraction/     → providers/      → OCR markdown
     │                (azure, gemini, mistral, ...)
     ▼
  structuring/    → LLM             → raw JSON
     │                (anthropic, openai, gemini, ...)
     ▼
  parsing/        → parse + coerce  → ParsedInvoiceData
     │                + validate
     ▼
  billing/        → footer extract  → enriched summary
     │                + bill math       (GST, discounts, totals)
     ▼
  response/       → toCanonical     → API / DB shape
```

## Key Design Decisions

- **`billing/footerExtract.ts`** is the single source of truth for financial totals — it deterministically re-reads the OCR footer, overriding LLM guesses for accuracy.
- **`providers/clients/`** isolates SDK-specific HTTP wrappers from the provider logic itself, making it easy to swap or mock SDKs.
- **`parsing/`** vs **`billing/`** separation: parsing handles raw LLM JSON → typed data; billing handles the financial math layer on top. This keeps concerns clean.
- **`config/`** centralizes env + DB — any file needing the DB or env imports from one place.
