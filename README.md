# BillParser — Fleet Maintenance OCR Platform

GCP-native, Firebase-based backend for automotive invoice OCR extraction, analytics, and fraud detection.

## Architecture

```
Frontend Upload / URL
        ↓
  Bill Processing Service (Cloud Run)
        ↓
  Cloud Storage (PDF/Image)
        ↓
  Mistral OCR → Raw Markdown
        ↓
  Gemini Normalization → toApiParsed() schema
        ↓
  Firestore (bills + bill_parts)
```

## Tech Stack

| Component       | Technology              |
|----------------|------------------------|
| Runtime        | Node.js 20 + TypeScript |
| Framework      | Fastify                 |
| Database       | Cloud Firestore         |
| File Storage   | Cloud Storage           |
| OCR Provider   | Mistral OCR             |
| Normalization  | Google Gemini           |
| Frontend       | React + Vite            |
| Deployment     | Cloud Run (Docker)      |

## Project Structure

```
├── platform/           # Backend (GCP/Firebase)
│   ├── src/
│   │   ├── config/     # env.ts, firebase.ts
│   │   ├── models/     # Firestore types + CRUD (bills, bill_parts, settings)
│   │   ├── services/   # Business logic
│   │   │   ├── billing/     # Upload → OCR → Normalize → Store
│   │   │   ├── analytics/   # Dashboard, vehicle spend, vendor, cost/km
│   │   │   └── fraud/       # Duplicates, GST, price, odometer checks
│   │   ├── routes/     # All API endpoints
│   │   └── lib/        # Shared utilities
│   └── tests/          # 42 tests
│
├── web/                # Frontend (React)
│   ├── src/
│   │   ├── pages/      # InvoicesPage, InvoiceDetailPage, AnalyticsPage, SettingsPage
│   │   ├── components/ # UI components
│   │   ├── api/        # API client
│   │   └── types/      # TypeScript interfaces
│   └── tests/
│
└── docker-compose.yml  # api + web (no PostgreSQL)
```

## Quick Start

```bash
# Backend
cd platform
cp .env.example .env
npm install
npm run dev

# Frontend
cd web
npm install
npm run dev
```

## Docker

```bash
docker compose up --build
# API: http://localhost:4000
# Web: http://localhost:8081
```

## API Endpoints

### Bills
| Method | Path | Description |
|--------|------|-------------|
| POST | /api/invoices/upload | Upload PDF/image |
| POST | /api/invoices/import | Import from URLs |
| GET | /api/invoices | List all bills |
| GET | /api/invoices/:id | Get bill detail |
| GET | /api/invoices/:id/file | Get original PDF |
| PATCH | /api/invoices/:id | Edit & verify |
| DELETE | /api/invoices/:id | Delete bill |
| POST | /api/parse | One-shot stateless parse |

### Analytics & Fraud
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/analytics | Dashboard summary |
| GET | /api/fraud/scan | Run all fraud checks |
| GET | /api/fraud/duplicates | Duplicate invoices |
| GET | /api/fraud/gst-anomalies | GST mismatch |

### Settings
| Method | Path | Description |
|--------|------|-------------|
| GET | /api/config | App configuration |
| GET | /api/settings | Provider settings |
| PUT | /api/settings | Save settings |

## Tests

```bash
cd platform && npm test
# 42 tests, 6 test files, all passing
```

## Cloud Run Deploy

```bash
docker build -t billparser-platform platform/
docker push gcr.io/PROJECT_ID/billparser-platform
gcloud run deploy billparser --image gcr.io/PROJECT_ID/billparser-platform --region asia-south1
```
