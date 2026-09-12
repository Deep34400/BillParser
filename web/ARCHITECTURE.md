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
- **`lib/summaryFromMarkdown.ts`** parses OCR markdown on the client for a live breakdown without an extra API call.
- **`types/index.ts`** centralizes all TypeScript interfaces shared across the app.
- **`lib/`** keeps formatting and model utilities separate from React components — pure functions, easy to test.
- **Pages** are route-level; **components** are reusable within pages; **overlays** are modal UIs that appear over pages.

## Data loading

The UI does **not** cache GET responses. Invoice list, counts, and analytics tabs call the API on each visit.

Analytics tabs stay lazy (fetch when first opened). Search is debounced 300ms.

Server-side only (`platform/src/shared/cache.ts`): 30s TTL on analytics aggregations, cleared when bills change.

### Analytics Split APIs
Instead of one monolithic `GET /api/analytics`, the frontend calls:
- `analyticsKpis()` — KPIs + workshops (loaded on page mount)
- `analyticsVehicles(?q=)` — vehicles (lazy, searchable)
- `analyticsWorkshops(?q=)` — workshops (searchable)
- `analyticsMonths()` — monthly spend (lazy)
- `analyticsCostkm()` — cost/km (lazy)
- `analyticsCosts()` — OCR API costs (lazy, on "API Costs" tab)

### Search
Workshops and Vehicles views have debounced search inputs (300ms) that hit server-side filtered endpoints.
