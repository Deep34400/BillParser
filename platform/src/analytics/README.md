# Analytics Module

Aggregates completed invoice data into dashboards — spend by vendor, vehicle, month, cost-per-km, and OCR cost tracking. All reads go through PostgreSQL; bill data is fetched via the OCR repository layer (which owns the `bills` table).

## How It Works — Full Flow

### What Triggers Analytics

Analytics are read-only — they never modify data. Every endpoint reads from the `bills` PostgreSQL table that the OCR module writes to. The analytics `repository.ts` delegates to `ocr/repository.ts` (`fetchAllBills`) so analytics never touches Sequelize models for bills directly.

When a user opens the Analytics page in the UI, the frontend fetches data from multiple smaller endpoints instead of one heavy endpoint.

### Data Flow

```
User opens Analytics page
  → Frontend calls GET /api/analytics/kpis (first, always)
  → Frontend shows KPI cards (total spend, avg confidence, etc.)
  → User clicks a tab (Workshops, Vehicles, Months, Cost/km, Costs)
  → Frontend lazy-loads that tab's data from its own endpoint
  → Data is cached on both server and client side
```

```
analytics/service.ts
  → analytics/repository.ts → fetchAllBills()
    → ocr/repository.ts (Sequelize queries against `bills` table)
  → In-memory aggregation in service.ts (GROUP BY logic in application code)
```

Completed bills are filtered using `OCR_STATUSES` values from `shared/constants.ts` (`OCR_COMPLETED`, `VERIFIED`, etc.).

### How Each Endpoint Works

**`GET /api/analytics/kpis`** — The main aggregation. `route.ts` calls `service.ts → computeKpis()`, which loads all bills via the repository layer and loops through them to compute:
- Total spend, parts total, labour total, tax total
- Completed bill count and average confidence score
- Bills needing review (have `review_reasons`)
- Spend by vendor (Map of vendor name → total amount)
- Spend by month (Map of YYYY-MM → total amount)

This is the most expensive call, so it's cached for 5 minutes server-side.

**`GET /api/analytics/vehicles?q=MH01`** — Calls `service.ts → getVehicleSpend()`. Groups bills by `vehicle_id` or `registration_number`, sums amounts per vehicle. Supports text search via `?q=` parameter. Results are paginated with `?limit=` and `?offset=`.

**`GET /api/analytics/workshops?q=vipul`** — Uses the KPI vendor data (same aggregation as `/kpis`). Junk vendor names are filtered out using `isJunkVendorName()` from the OCR module. Supports text search and pagination.

**`GET /api/analytics/months`** — Uses the KPI month data. Returns spend by month sorted chronologically, paginated.

**`GET /api/analytics/costkm`** — Calls `service.ts → getCostPerKm()`. Finds vehicles with 2+ bills that have odometer readings, calculates the km range and cost per km.

**`GET /api/analytics/costs`** — Calls `service.ts → getOcrCostSummary()`. Aggregates token usage and USD costs across all completed OCR runs, grouped by provider.

**`GET /api/analytics`** — Combined endpoint (deprecated; UI should use individual endpoints above).

### Caching Strategy

**Server-side** (in `route.ts` using `shared/cache.ts`):
- Each endpoint result is cached with a 5-minute TTL
- Cache key = endpoint path (e.g., `analytics:kpis`, `analytics:vehicles`)
- Search queries (`?q=...`) filter cached data in memory (KPI cache is shared across workshops/months tabs)
- Cache is invalidated when the OCR module creates, updates, or deletes a bill

**Client-side** (in the frontend `AnalyticsPage.tsx`):
- 60-second TTL per endpoint
- Tabs only fetch their data when first opened (lazy loading)
- Avoids redundant API calls during normal navigation

### Why Separate Endpoints

With growing data (lakhs of records), one monolithic `/api/analytics` endpoint would be too slow. Splitting into focused endpoints means:
- Each endpoint returns a small, focused payload
- Tabs that the user never opens are never fetched
- Caching is more effective (each endpoint cached independently)
- Search only re-fetches the relevant endpoint

## File Reference

| File | What it does |
|------|-------------|
| `route.ts` | HTTP endpoints with caching, pagination, and search filtering |
| `service.ts` | Aggregation logic — KPIs, vehicle spend, cost/km, OCR costs |
| `repository.ts` | Thin data-access layer — delegates bill reads to `ocr/repository.ts` |

## Data Source

All analytics read from the PostgreSQL `bills` table via the OCR repository layer. No separate analytics tables or materialized views — aggregation runs in `service.ts` over the fetched bill set. Local dev and production both run PostgreSQL (Docker locally, Cloud SQL deployed), so behaviour is identical.
