# BillParser — Fleet Invoice OCR

Extracts structured data from automotive invoices (PDF/image), then analytics and fraud checks.

## Docs

| Doc | What it covers |
|-----|----------------|
| [platform/ARCHITECTURE.md](platform/ARCHITECTURE.md) | System overview, API list, deploy |
| [platform/DATABASE.md](platform/DATABASE.md) | All 8 tables, FKs, indexes |
| [platform/src/ocr/README.md](platform/src/ocr/README.md) | OCR pipeline (how the code runs) |
| [platform/src/users/README.md](platform/src/users/README.md) | Auth, API keys, token billing |
| [platform/src/vendor/README.md](platform/src/vendor/README.md) | Vendor matching |
| [platform/src/analytics/README.md](platform/src/analytics/README.md) | KPIs and spend |
| [platform/src/fraud/README.md](platform/src/fraud/README.md) | Anomaly checks |
| [web/ARCHITECTURE.md](web/ARCHITECTURE.md) | React UI |

## Stack

PostgreSQL + Sequelize · Fastify · GCS · Mistral / Gemini · React + Vite · Cloud Run

## Quick start

```bash
# Postgres must be running (DATABASE_URL in platform/.env)

# Terminal 1 — API
cd platform && npm install && npm run dev    # :4000

# Terminal 2 — UI
cd web && npm install && npm run dev         # :5173
```

Vite proxies `/api/*` to `:4000`. Default login: `admin@praya.io` (password from `ADMIN_PASSWORD` or `admin123` in non-prod).

```bash
docker compose up --build   # API :4000, web :8081
cd platform && npm test
```
