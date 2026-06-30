# Web Architecture

React + TypeScript SPA for invoice management, built with Vite.

## Folder Structure

```
web/
├── src/
│   ├── main.tsx               # App entry point (React root)
│   ├── App.tsx                # Router + top-level layout
│   ├── theme.ts               # Shared color palette + style tokens
│   │
│   ├── api/                   # API client layer
│   │   └── client.ts          # HTTP methods for all backend endpoints
│   │
│   ├── types/                 # TypeScript type definitions
│   │   └── index.ts           # Invoice, AppConfig, SettingsData, etc.
│   │
│   ├── lib/                   # Pure utilities & business logic
│   │   ├── format.ts          # Money, date, confidence formatting
│   │   ├── structuringModels.ts  # LLM model suggestions per provider
│   │   └── summaryFromMarkdown.ts # Client-side bill summary parser
│   │                             (mirrors api/src/billing/)
│   │
│   ├── components/            # Reusable UI components
│   │   ├── Shell.tsx          # App shell (sidebar + header)
│   │   ├── Toast.tsx          # Toast notification
│   │   ├── StatusDot.tsx      # Extraction status indicator
│   │   ├── ConfidenceBar.tsx  # Confidence score bar
│   │   ├── InvoiceBreakdown.tsx  # Detailed parts/labour/GST breakdown
│   │   ├── SummaryBreakdown.tsx  # Compact bill summary card
│   │   └── SummaryColumns.tsx    # Parts vs Labour column view
│   │
│   ├── hooks/                 # Custom React hooks
│   │   └── usePolling.ts      # Auto-refresh while extraction runs
│   │
│   ├── overlays/              # Modal/overlay components
│   │   ├── CompareOverlay.tsx # Side-by-side invoice comparison
│   │   └── BakeoffOverlay.tsx # Multi-provider accuracy comparison
│   │
│   └── pages/                 # Route-level page components
│       ├── InvoicesPage.tsx   # Invoice list + upload + batch
│       ├── InvoiceDetailPage.tsx # Single invoice view + PDF viewer
│       ├── AnalyticsPage.tsx  # Dashboard charts + KPIs
│       └── SettingsPage.tsx   # Provider config + credential mgmt
│
├── tests/                     # Mirrors src/ structure
│   ├── lib/                   # format, structuringModels tests
│   ├── AnalyticsPage.test.tsx
│   ├── InvoiceDetailPage.test.tsx
│   ├── InvoicesPage.test.tsx
│   ├── Overlays.test.tsx
│   ├── SettingsPage.test.tsx
│   ├── filterPdfs.test.ts
│   ├── format.test.ts
│   └── usePolling.test.tsx
│
├── index.html                 # Vite HTML entry
├── nginx.conf                 # Production reverse-proxy config
├── vite.config.ts
├── tsconfig.json
├── package.json
└── Dockerfile
```

## Key Design Decisions

- **`api/client.ts`** is the single point of contact with the backend — all HTTP calls go through this module. Easy to mock in tests.
- **`lib/summaryFromMarkdown.ts`** mirrors the API's `billing/` logic so the UI can show real-time bill breakdowns from raw OCR markdown without a backend round-trip.
- **`types/index.ts`** centralizes all TypeScript interfaces shared across the app.
- **`lib/`** keeps formatting and model utilities separate from React components — pure functions, easy to test.
- **Pages** are route-level; **components** are reusable within pages; **overlays** are modal UIs that appear over pages.
