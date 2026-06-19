# Invoice OCR

A self-hosted web application that turns PDF invoices/bills into structured data. Upload PDFs through the browser, extract fields via your choice of OCR/AI provider, review and edit results, then search and export from a persistent Postgres ledger.

## What it does

- **Upload & extract** — drop one or more PDFs on the Invoices page; the API sends each to the active extraction provider and stores the result in a canonical schema (vendor, dates, amounts, line items, tax, currency, etc.).
- **Ledger UI** — searchable, filterable table of all processed invoices with status badges (PENDING / PROCESSING / COMPLETED / FAILED).
- **Detail view** — per-invoice field view with inline edit + verify workflow; see raw provider output alongside structured fields.
- **Analytics** — spending summaries, vendor breakdowns, and trends across the ledger.
- **Live provider bake-off** — re-extract any invoice against any configured provider without re-uploading.
- **CSV export** — download the full ledger or a filtered slice.
- **Settings** — configure provider credentials, choose the active extraction provider, and (for markdown providers) the structuring model.

## Stack

| Layer    | Technology                           |
|----------|--------------------------------------|
| Frontend | React 18 + Vite 5, TypeScript        |
| Backend  | Fastify 4 + Prisma 5, TypeScript     |
| Database | Postgres 16                          |
| Runtime  | Node 20 (api), nginx alpine (web)    |
| Packaging| Docker Compose                       |

## Quick start (Docker)

```bash
cp .env.example .env
# Edit .env: set a strong APP_SECRET; optionally seed provider API keys.
# Or generate one on the fly:
APP_SECRET=$(openssl rand -hex 32) docker compose up --build
```

- Web UI: http://localhost:8080
- API: http://localhost:4000

The API container runs `prisma migrate deploy` automatically on startup, so the database schema is applied before the server begins accepting traffic.

## Configure a provider

Open **Settings** in the app and enter credentials for at least one provider, then choose the active extraction provider (and, for markdown providers, the structuring model provider and model). After saving, uploaded PDFs will be extracted and structured automatically.

If no credentials are configured for the active provider, uploads are accepted but extraction moves to **FAILED** with a clear "no credentials configured" error message — this is by design; there is no mock/stub provider.

## Provider matrix

| Provider              | Key         | Output type | Status                        |
|-----------------------|-------------|-------------|-------------------------------|
| Mistral OCR           | `mistral`   | Markdown    | Built, default                |
| Azure Document Intelligence | `azure` | Structured | Built                        |
| LlamaParse            | `llamaparse`| Markdown    | Built                         |
| AWS Textract          | `textract`  | Structured  | Built                         |
| Google Document AI    | `google`    | Structured  | Stubbed — returns "not implemented" error |

**Markdown providers** (Mistral, LlamaParse) produce raw markdown from the PDF, then run a second LLM structuring pass to extract canonical fields. The structuring model is configurable in Settings (supports Anthropic, OpenAI, and Mistral).

**Structured providers** (Azure, Textract) return pre-parsed field maps that are mapped directly to the canonical schema without a second LLM call.

## Local development

### 1. Start a dev Postgres

```bash
docker run -d --name ioc-pg \
  -e POSTGRES_USER=invoice \
  -e POSTGRES_PASSWORD=invoice \
  -e POSTGRES_DB=invoice \
  -p 5432:5432 \
  postgres:16
```

### 2. Start the API

```bash
cd api
cp ../.env.example .env   # edit DATABASE_URL / APP_SECRET / provider keys as needed
npx prisma migrate dev
npm run dev               # tsx watch — hot-reloads on save
```

### 3. Start the web dev server

```bash
cd web
npm install
npm run dev               # Vite proxies /api/* to http://localhost:4000
```

Vite's dev proxy is configured in `web/vite.config.ts`; set `VITE_API_BASE` in `.env` only for non-Vite builds.

## Tests

```bash
# API — 38 tests (Vitest against a live Postgres; requires DB running)
cd api && npm test

# Web — 8 tests (Vitest + jsdom, no network required)
cd web && npm test
```

## Security notes

- **Credential storage**: provider credentials entered in Settings are stored in Postgres encrypted with AES-256-GCM, keyed from `APP_SECRET`. The default `GET /api/settings` returns only masked hints (e.g. `••••abcd`) and never the raw key.
- **Credential reveal**: a dedicated `GET /api/settings/reveal` endpoint returns the **decrypted** credentials so the Settings UI can repopulate fields across reloads. This intentionally sends plaintext secrets to the client — it is safe only because v1 is single-tenant with no auth (see below). If you add authentication, gate this endpoint.
- **No authentication**: v1 has no login/session system. Deploy on trusted or internal infrastructure only. Authentication is on the roadmap.
- **`APP_SECRET`**: must be set to a strong random value in production. The Docker Compose default (`dev-secret-change-me`) is intentionally weak and must be replaced before exposing the service externally.

## Environment variables

All variables live in `.env` (copy from `.env.example`).

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `APP_SECRET` | Yes | Secret key for AES-256-GCM credential encryption |
| `UPLOAD_DIR` | No | Directory for uploaded PDFs (default `./uploads`) |
| `PORT` | No | API listen port (default `4000`) |
| `EXTRACTION_PROVIDER` | No | Seed the active extraction provider on first boot (`mistral`, `azure`, `llamaparse`, `textract`, `google`) |
| `STRUCTURING_MODEL_PROVIDER` | No | Seed the structuring model provider (`anthropic`, `openai`, `mistral`) |
| `STRUCTURING_MODEL` | No | Seed the structuring model ID (e.g. `claude-sonnet-4-6`) |
| `MISTRAL_API_KEY` | No | Seed Mistral API key |
| `AZURE_DI_ENDPOINT` | No | Seed Azure Document Intelligence endpoint URL |
| `AZURE_DI_KEY` | No | Seed Azure Document Intelligence API key |
| `LLAMAPARSE_API_KEY` | No | Seed LlamaParse API key |
| `ANTHROPIC_API_KEY` | No | Seed Anthropic API key (for structuring) |
| `OPENAI_API_KEY` | No | Seed OpenAI API key (for structuring) |
| `VITE_API_BASE` | No | API base URL for the web build (Vite dev server uses its proxy instead) |

Seed variables are applied only if no matching setting already exists in the database; the Settings UI always takes precedence after the first boot.
