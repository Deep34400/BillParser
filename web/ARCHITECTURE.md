# Web Architecture

React 18 + TypeScript SPA for invoice management, built with Vite 5, Tailwind CSS v4, shadcn/ui, and @tanstack/react-query.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 18 + TypeScript |
| Build | Vite 5 |
| Styling | Tailwind CSS v4 (CSS-first config) + dark mode (`.dark` class) |
| Components | shadcn/ui (Radix primitives + CVA) — 18 primitives |
| Data fetching | @tanstack/react-query (AnalyticsPage, InvoicesPage, AdminPage, AuditLogPanel, ApiDocsPage) |
| Charts | recharts (donut, stacked bars, composed chart, sparklines on Analytics) |
| Toasts | sonner (replaces custom Toast for notifications) |
| Icons | Lucide React |
| Tests | Vitest + React Testing Library |
| Path alias | `@/` → `./src` (tsconfig + Vite) |

## Folder Structure

```
web/
├── src/
│   ├── main.tsx               # App entry (globals.css, ErrorBoundary)
│   ├── App.tsx                # QueryClientProvider, Router, sonner Toaster
│   ├── theme.ts               # Legacy color tokens (kept for a few shared helpers)
│   │
│   ├── styles/
│   │   └── globals.css        # Tailwind v4 @theme + dark mode tokens
│   │
│   ├── api/
│   │   └── client.ts          # HTTP methods for all backend endpoints
│   │
│   ├── types/
│   │   └── index.ts           # Invoice, AppConfig, SettingsData, etc.
│   │
│   ├── lib/
│   │   ├── utils.ts           # cn() — clsx + tailwind-merge
│   │   ├── format.ts          # Money, date, confidence formatting
│   │   ├── tourFlow.ts        # ProductTour step definitions
│   │   ├── structuringModels.ts
│   │   └── summaryFromMarkdown.ts
│   │
│   ├── components/
│   │   ├── ui/                # shadcn/ui primitives (18 components)
│   │   │   ├── alert-dialog.tsx, badge.tsx, button.tsx, card.tsx
│   │   │   ├── dialog.tsx, dropdown-menu.tsx, empty-state.tsx
│   │   │   ├── input.tsx, label.tsx, select.tsx, separator.tsx
│   │   │   ├── sheet.tsx, skeleton.tsx, switch.tsx, table.tsx
│   │   │   ├── tabs.tsx, textarea.tsx, tooltip.tsx
│   │   │
│   │   ├── invoice/           # InvoiceDetailPage sub-components (14)
│   │   │   ├── StatusBadge.tsx, StatusTimeline.tsx
│   │   │   ├── InvoiceHeader.tsx, InvoiceToolbar.tsx, InvoiceFieldGrid.tsx
│   │   │   ├── PartsTable.tsx, LabourTable.tsx, CostBreakdown.tsx
│   │   │   ├── OcrCostPanel.tsx, FallbackComparePanel.tsx
│   │   │   ├── InvoiceEditForm.tsx, ApprovalBar.tsx
│   │   │   ├── CommentsPanel.tsx, InvoicePdfSplit.tsx
│   │   │
│   │   ├── Shell.tsx          # Sidebar nav, dark mode toggle, Help menu, mobile Sheet
│   │   ├── ProductTour.tsx    # Custom guided tour (replaces react-joyride)
│   │   ├── GuidedTour.tsx     # Tour orchestration wrapper
│   │   ├── WebhooksPanel.tsx
│   │   ├── AuditLogPanel.tsx  # React Query
│   │   ├── ConfirmDialog.tsx  # Replaces browser confirm()
│   │   ├── PromptDialog.tsx   # Replaces browser prompt()
│   │   ├── ErrorBoundary.tsx, ErrorState.tsx
│   │   ├── UploadProgress.tsx, WelcomeDialog.tsx
│   │   ├── FeatureHint.tsx, HelpTip.tsx
│   │   ├── StatusDot.tsx, ConfidenceBar.tsx, DocNote.tsx
│   │   ├── DocumentPreview.tsx, InvoiceBreakdown.tsx
│   │   ├── SummaryBreakdown.tsx, SummaryColumns.tsx
│   │   └── Toast.tsx          # Legacy; sonner preferred
│   │
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── InvoicesPage.tsx       # React Query, drag-and-drop upload, cursor pagination
│   │   ├── ComparePage.tsx        # Compare two invoices (ids / JSON / files) + model + mismatch list
│   │   ├── InvoiceDetailPage.tsx  # Orchestrates invoice/* components (~438 lines)
│   │   ├── AnalyticsPage.tsx      # React Query + recharts
│   │   ├── FraudPage.tsx
│   │   ├── OdometerPage.tsx
│   │   ├── AccountPage.tsx
│   │   ├── ActivityPage.tsx
│   │   ├── SettingsPage.tsx       # shadcn/Tailwind (~705 lines)
│   │   ├── AdminPage.tsx          # shadcn/Tailwind + React Query (~552 lines)
│   │   ├── TutorialPage.tsx     # Video-style slide walkthrough
│   │   ├── UserGuidePage.tsx      # Written how-to guide
│   │   ├── ApiDocsPage.tsx        # Interactive API reference (fetches GET /api/docs)
│   │   └── tutorialSlides.ts
│   │
│   ├── hooks/
│   │   └── usePolling.ts      # Legacy; React Query refetchInterval preferred
│   │
│   └── overlays/
│       ├── CompareOverlay.tsx
│       └── BakeoffOverlay.tsx
│
├── tests/
├── index.html
├── nginx.conf
├── vite.config.ts
├── tsconfig.json
├── package.json
└── Dockerfile
```

## Design System

### Design Tokens

All design tokens are defined in `src/styles/globals.css` using Tailwind v4's `@theme` directive. Dark mode toggles the `.dark` class on `<html>` (persisted in `localStorage` via `Shell.tsx`).

| Token | CSS Variable | Usage |
|-------|-------------|-------|
| Background | `--color-background` | Page background |
| Foreground | `--color-foreground` | Primary text |
| Primary | `--color-primary` | Buttons, links, accents |
| Secondary | `--color-secondary` | Muted elements |
| Muted | `--color-muted` | Borders, disabled states |
| Success | `--color-success` | Completed, good confidence |
| Warning | `--color-warning` | Review, medium confidence |
| Danger | `--color-danger` | Errors, low confidence |

### Component Library (shadcn/ui)

Built on [Radix UI](https://www.radix-ui.com/) primitives with [class-variance-authority](https://cva.style/) for variant management.

**Key patterns:**
- **`cn()` utility** — merges Tailwind classes using `clsx` + `tailwind-merge`
- **CVA variants** — each component defines variants (e.g., Button: `default | destructive | outline | success | warning`)
- **`forwardRef`** — all components forward refs for composition
- **Slot pattern** — `asChild` prop renders the child element instead of a wrapper
- **Skeleton** — loading placeholders on InvoicesPage, AnalyticsPage, AdminPage, detail views

## Help & Onboarding

The **Help** menu in `Shell.tsx` provides:

| Item | Route / action |
|------|----------------|
| Watch tutorial | `/tutorial` — slide walkthrough (upload → extract → detail → analytics → API key → export) |
| Take a tour | `ProductTour` — custom guided tour with multi-page navigation |
| User guide | `/docs` — written how-to (`UserGuidePage.tsx`) |
| API reference | `/api-docs` — interactive docs from `GET /api/docs` |

`react-joyride` is installed but **replaced** by the custom `ProductTour.tsx` component.

## Key Design Decisions

- **`api/client.ts`** is the single point of contact with the backend — all HTTP calls go through this module.
- **`@tanstack/react-query`** caches GET responses with 30s stale time; invoice list polls every 3s while any bill is `PROCESSING`.
- **`lib/summaryFromMarkdown.ts`** parses OCR markdown on the client for a live breakdown without an extra API call.
- **`types/index.ts`** centralizes all TypeScript interfaces shared across the app.
- **Pages** are route-level; **`components/invoice/`** holds detail-page sub-components; **overlays** are modal UIs.
- **`ConfirmDialog` / `PromptDialog`** replace native `confirm()` / `prompt()` for consistent UX.
- **Mobile** — hamburger menu via shadcn `Sheet` in `Shell.tsx`.

## Data Loading

### React Query

| Page / component | Query key pattern | Notes |
|------------------|-------------------|-------|
| `InvoicesPage` | invoices, counts, batches | `refetchInterval: 3000` while PROCESSING |
| `AnalyticsPage` | kpis, months, workshops, vehicles, costs | Lazy tabs fetch on first open |
| `AdminPage` | admin users | |
| `AuditLogPanel` | audit logs | |
| `ApiDocsPage` | `/api/docs` | Public endpoint |

Default options (`App.tsx`): `staleTime: 30_000`, `retry: 1`, `refetchOnWindowFocus: true`.

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

Charts use **recharts**: donut (status breakdown), stacked bars (monthly spend), composed chart (cost/km), sparklines (vehicle trends).

### Search & Filters

Workshops and Vehicles views have debounced search inputs (300ms). Invoice list supports server-side filters: `minTotal`, `maxTotal`, `dateFrom`, `dateTo`, `vendor` (ILIKE), plus cursor pagination.

## Conversion Status

All pages and primary components are converted to Tailwind + shadcn/ui.

| Page/Component | Status | Styling |
|----------------|--------|---------|
| Shell.tsx | ✅ Converted | Tailwind + dark mode + Help menu + mobile Sheet |
| LoginPage.tsx | ✅ Converted | shadcn Card/Input/Label/Button |
| InvoicesPage.tsx | ✅ Converted | React Query, drag-and-drop, Skeleton, sonner |
| InvoiceDetailPage.tsx | ✅ Converted | 14 sub-components in `components/invoice/` |
| AccountPage.tsx | ✅ Converted | API keys, webhooks, activity, usage |
| FraudPage.tsx | ✅ Converted | shadcn Card/Badge/Button/EmptyState |
| AnalyticsPage.tsx | ✅ Converted | React Query + recharts + shadcn Tabs/Card |
| OdometerPage.tsx | ✅ Converted | shadcn Card/Badge/Button/EmptyState |
| SettingsPage.tsx | ✅ Converted | shadcn/Tailwind (~705 lines) |
| AdminPage.tsx | ✅ Converted | shadcn/Tailwind + React Query (~552 lines) |
| TutorialPage.tsx | ✅ Converted | Slide walkthrough |
| UserGuidePage.tsx | ✅ Converted | Written guide |
| ApiDocsPage.tsx | ✅ Converted | Interactive API reference |
| ActivityPage.tsx | ✅ Converted | Activity history |
| ProductTour.tsx | ✅ Converted | Custom guided tour |
| CommentsPanel.tsx | ✅ Converted | Invoice detail comments |
| StatusBadge.tsx | ✅ Converted | OCR status chip |
| StatusTimeline.tsx | ✅ Converted | Pipeline progress |
| UploadProgress.tsx | ✅ Converted | Batch upload progress |
| ConfirmDialog.tsx | ✅ Converted | Replaces browser confirm |
| PromptDialog.tsx | ✅ Converted | Replaces browser prompt |
| ErrorBoundary.tsx | ✅ Converted | Top-level error catch |
| ErrorState.tsx | ✅ Converted | Inline error + retry |
| AuditLogPanel.tsx | ✅ Converted | React Query + Skeleton |
| WebhooksPanel.tsx | ✅ Converted | Webhook CRUD |
| StatusDot.tsx | ✅ Converted | Tailwind + pulse animation |
| ConfidenceBar.tsx | ✅ Converted | Tailwind progress bar |
| DocNote.tsx | ✅ Converted | Tailwind term/desc list |
| DocumentPreview.tsx | ✅ Converted | PDF/image preview |
| InvoiceBreakdown.tsx | ✅ Converted | Parts/labour/GST breakdown |
| CompareOverlay.tsx | ✅ Converted | Side-by-side comparison |
| BakeoffOverlay.tsx | ✅ Converted | Multi-provider comparison |
