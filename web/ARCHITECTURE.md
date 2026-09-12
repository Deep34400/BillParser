# Web Architecture

React 18 + TypeScript SPA for invoice management, built with Vite 5, Tailwind CSS v4, and shadcn/ui.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 18 + TypeScript |
| Build | Vite 5 |
| Styling | Tailwind CSS v4 (CSS-first config) |
| Components | shadcn/ui (Radix primitives + CVA) |
| Icons | Lucide React |
| Tests | Vitest + React Testing Library |
| Path alias | `@/` → `./src` (tsconfig + Vite) |

## Folder Structure

```
web/
├── src/
│   ├── main.tsx               # App entry point (imports globals.css)
│   ├── App.tsx                # Router + top-level layout
│   ├── theme.ts               # Legacy color tokens (for unconverted pages)
│   │
│   ├── styles/
│   │   └── globals.css        # Tailwind v4 config + design tokens (@theme)
│   │
│   ├── api/                   # API client layer
│   │   └── client.ts          # HTTP methods for all backend endpoints
│   │
│   ├── types/                 # TypeScript type definitions
│   │   └── index.ts           # Invoice, AppConfig, SettingsData, etc.
│   │
│   ├── lib/                   # Pure utilities & business logic
│   │   ├── utils.ts           # cn() — clsx + tailwind-merge
│   │   ├── format.ts          # Money, date, confidence formatting
│   │   ├── structuringModels.ts  # LLM model suggestions per provider
│   │   └── summaryFromMarkdown.ts # Client-side bill summary parser
│   │
│   ├── components/            # Reusable UI components
│   │   ├── ui/                # shadcn/ui primitives (15 components)
│   │   │   ├── button.tsx     # 8 variants × 4 sizes (CVA)
│   │   │   ├── card.tsx       # Card + Header/Title/Description/Content/Footer
│   │   │   ├── badge.tsx      # 9 variants (success, warning, danger, info, etc.)
│   │   │   ├── input.tsx      # Styled text input
│   │   │   ├── table.tsx      # Table/Header/Body/Row/Cell
│   │   │   ├── tabs.tsx       # Radix Tabs
│   │   │   ├── dialog.tsx     # Modal with overlay + animations
│   │   │   ├── dropdown-menu.tsx  # Radix DropdownMenu
│   │   │   ├── select.tsx     # Radix Select with check indicator
│   │   │   ├── tooltip.tsx    # Radix Tooltip
│   │   │   ├── separator.tsx  # Horizontal/vertical
│   │   │   ├── textarea.tsx   # Multi-line text input
│   │   │   ├── switch.tsx     # Toggle switch
│   │   │   ├── label.tsx      # Form label
│   │   │   └── empty-state.tsx # Empty state with icon + action
│   │   │
│   │   ├── Shell.tsx          # App shell (sidebar nav + header)
│   │   ├── Toast.tsx          # Toast notification (3 variants)
│   │   ├── StatusDot.tsx      # OCR status indicator with pulse animation
│   │   ├── ConfidenceBar.tsx  # Confidence score progress bar
│   │   ├── DocNote.tsx        # Term-description list for fraud/analytics
│   │   ├── InvoiceBreakdown.tsx   # ⚠ Legacy — parts/labour/GST breakdown
│   │   ├── SummaryBreakdown.tsx   # ⚠ Legacy — compact bill summary
│   │   ├── SummaryColumns.tsx     # ⚠ Legacy — parts vs labour columns
│   │   ├── SearchableTable.tsx    # ⚠ Legacy — search table
│   │   └── DocumentPreview.tsx    # ⚠ Legacy — PDF/image preview
│   │
│   ├── pages/                 # Route-level page components
│   │   ├── LoginPage.tsx      # ✅ Converted — shadcn Card/Input/Button
│   │   ├── InvoicesPage.tsx   # ✅ Converted — shadcn Table/Badge/Button
│   │   ├── AccountPage.tsx    # ✅ Converted — shadcn Card/Table/Badge
│   │   ├── FraudPage.tsx      # ✅ Converted — shadcn Card/Badge/EmptyState
│   │   ├── AnalyticsPage.tsx  # ✅ Converted — shadcn Tabs/Card/Table
│   │   ├── OdometerPage.tsx   # ✅ Converted — shadcn Card/Badge/EmptyState
│   │   ├── InvoiceDetailPage.tsx  # ⚠ Legacy — uses theme.ts tokens
│   │   ├── SettingsPage.tsx       # ⚠ Legacy — uses theme.ts tokens
│   │   └── AdminPage.tsx          # ⚠ Legacy — uses theme.ts tokens
│   │
│   ├── hooks/                 # Custom React hooks
│   │   └── usePolling.ts      # Auto-refresh while extraction runs
│   │
│   └── overlays/              # Modal/overlay components
│       ├── CompareOverlay.tsx # ⚠ Legacy — side-by-side comparison
│       └── BakeoffOverlay.tsx # ⚠ Legacy — multi-provider comparison
│
├── tests/                     # Mirrors src/ structure
├── index.html                 # Vite HTML entry
├── nginx.conf                 # Production reverse-proxy config
├── vite.config.ts             # Vite + @tailwindcss/vite + @ alias
├── tsconfig.json              # baseUrl + paths for @/* alias
├── package.json
└── Dockerfile
```

> **⚠ Legacy** = still uses inline styles + `theme.ts` tokens. These files work correctly via backward-compatible `theme.ts`, but should be converted to Tailwind in a future pass.

## Design System

### Design Tokens

All design tokens are defined in `src/styles/globals.css` using Tailwind v4's `@theme` directive:

| Token | CSS Variable | Value | Usage |
|-------|-------------|-------|-------|
| Background | `--color-background` | `#F7F6F1` | Page background (warm paper) |
| Foreground | `--color-foreground` | `#1B1D19` | Primary text (ink) |
| Primary | `--color-primary` | `#2E5C8A` | Buttons, links, accents |
| Secondary | `--color-secondary` | `#B8BFAA` | Muted elements |
| Muted | `--color-muted` | `#E8E6DF` | Borders, disabled states |
| Success | `--color-success` | `#3E7B4C` | Good confidence, completed |
| Warning | `--color-warning` | `#B8860B` | Medium confidence, review |
| Danger | `--color-danger` | `#9B2C2C` | Low confidence, errors |

### Component Library (shadcn/ui)

Built on [Radix UI](https://www.radix-ui.com/) primitives with [class-variance-authority](https://cva.style/) for variant management.

**Key patterns:**
- **`cn()` utility** — merges Tailwind classes using `clsx` + `tailwind-merge` (avoids conflicts)
- **CVA variants** — each component defines variants (e.g., Button has `default | destructive | outline | success | warning`)
- **`forwardRef`** — all components forward refs for composition
- **Slot pattern** — `asChild` prop renders the child element instead of a wrapper

### Backward Compatibility

- `theme.ts` is preserved — unconverted pages still import `T` tokens for inline styles
- `tokens.css` is preserved — for any CSS that references old custom properties
- `globals.css` is imported in `main.tsx` — provides all Tailwind utilities globally

## Key Design Decisions

- **`api/client.ts`** is the single point of contact with the backend — all HTTP calls go through this module. Easy to mock in tests.
- **`lib/summaryFromMarkdown.ts`** parses OCR markdown on the client for a live breakdown without an extra API call.
- **`types/index.ts`** centralizes all TypeScript interfaces shared across the app.
- **`lib/`** keeps formatting and model utilities separate from React components — pure functions, easy to test.
- **Pages** are route-level; **components** are reusable within pages; **overlays** are modal UIs that appear over pages.
- **`components/ui/`** contains shadcn/ui primitives — unstyled Radix + Tailwind, no business logic.

## Data Loading

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

## Conversion Status

| Page/Component | Status | Styling |
|----------------|--------|---------|
| Shell.tsx | ✅ Converted | Tailwind + shadcn Button/Separator |
| LoginPage.tsx | ✅ Converted | shadcn Card/Input/Label/Button |
| InvoicesPage.tsx | ✅ Converted | shadcn Table/Badge/Button/Input/Card |
| AccountPage.tsx | ✅ Converted | shadcn Card/Table/Badge/Button/Input |
| FraudPage.tsx | ✅ Converted | shadcn Card/Badge/Button/EmptyState |
| AnalyticsPage.tsx | ✅ Converted | shadcn Tabs/Card/Table/Input/Button |
| OdometerPage.tsx | ✅ Converted | shadcn Card/Badge/Button/EmptyState |
| StatusDot.tsx | ✅ Converted | Tailwind + ioc-pulse animation |
| Toast.tsx | ✅ Converted | Tailwind + variants (default/success/error) |
| ConfidenceBar.tsx | ✅ Converted | Tailwind progress bar |
| DocNote.tsx | ✅ Converted | Tailwind term/desc list |
| InvoiceDetailPage.tsx | ⏳ Pending | Inline styles + theme.ts (2,218 lines) |
| SettingsPage.tsx | ⏳ Pending | Inline styles + theme.ts (813 lines) |
| AdminPage.tsx | ⏳ Pending | Inline styles + theme.ts (527 lines) |
| DocumentPreview.tsx | ⏳ Pending | Inline styles |
| InvoiceBreakdown.tsx | ⏳ Pending | Inline styles |
| CompareOverlay.tsx | ⏳ Pending | Inline styles |
| BakeoffOverlay.tsx | ⏳ Pending | Inline styles |
