# Firestore → Postgres Migration Plan

**Target GCP project:** `carrum-doc-ai`
**Branch:** `dev-pg` (from `dev`, with `deepak_odo_fetaure` merged in — done, merge was clean)
**Data migration:** none — fresh empty database. The live project `carrum-agent-pilot-dev` is **not touched at any point**.

---

## 0. Governing principle (read this first)

> **The TypeScript domain interfaces do not change.**
> `BillDoc`, `BillPartDoc`, `UserDoc`, `ApiKeyDoc`, `TokenTransactionDoc`, `VendorDoc`, `AppSettings` keep their exact current shape, including `created_at`/`updated_at` as **ISO strings**.

The repository layer converts Postgres rows → these Docs at its boundary. Everything above the repository — services, routes, mappers, the entire `web/` app, and all 30 existing tests — stays untouched.

This is what makes the migration mechanical instead of a rewrite. Any change that leaks a Postgres type (a `Date` object, a `NUMERIC`-as-string) above the repository boundary is a defect.

---

## 1. Naming convention

One Cloud SQL **instance** is shared across environments; each environment gets its own **database** inside it plus its own dedicated Cloud Run services. There is no dedicated prod database instance — only prod Cloud Run is dedicated, when that's needed later.

| Resource | Name | Notes |
|---|---|---|
| GCP Project | `carrum-doc-ai` | already created |
| Runtime service account | `billparser-runtime@carrum-doc-ai.iam.gserviceaccount.com` | matches the old project's SA name — created |
| Cloud SQL instance | `billparser-pg` | shared, no env suffix — hosts both databases |
| Dev database | `billparser_dev` | Postgres snake_case convention |
| Prod database | `billparser_prod` | created later, same instance |
| Dev app DB role | `billparser_app_dev` | scoped to the dev database only |
| Prod app DB role | `billparser_app_prod` | created later, scoped to prod database only |
| Secret (dev connection string) | `billparser-db-url-dev` | per-environment — each Cloud Run service reads its own |
| Secret (prod connection string) | `billparser-db-url-prod` | created later |
| Dev uploads bucket | `carrum-doc-ai-uploads-dev` | separate bucket per env — cheap isolation, no dev/prod file mixing |
| Prod uploads bucket | `carrum-doc-ai-uploads-prod` | created later |
| Cloud Run backend (dev) | `billparser-platform-dev` | unchanged from the old project's naming |
| Cloud Run backend (prod, later) | `billparser-platform-prod` | |

---

## 2. Phase 1 — GCP infrastructure (`carrum-doc-ai`)

APIs enabled, runtime SA created. Remaining steps:

```bash
gcloud config set project carrum-doc-ai
```

### Create the instance

`carrum-doc-ai` has an org policy defaulting new Cloud SQL instances to **Enterprise Plus** edition, which doesn't support shared-core tiers like `db-f1-micro` — `--edition=ENTERPRISE` must be passed explicitly to unlock it.

```bash
gcloud sql instances create billparser-pg \
  --project=carrum-doc-ai \
  --edition=ENTERPRISE \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region=asia-southeast1 \
  --storage-size=10GB \
  --storage-type=SSD \
  --storage-auto-increase \
  --backup-start-time=19:00
```

Then create the `dev` database and its scoped application role. **Do not put the password in this file or in any committed file** — generate it and store it in Secret Manager:

```bash
gcloud sql databases create billparser_dev --instance=billparser-pg
gcloud sql users create billparser_app_dev --instance=billparser-pg --prompt-for-password
```

Store the full connection string in Secret Manager (`billparser-db-url-dev`) and grant the runtime service account access to it. The Cloud Run service reads it as a secret env var, never as a plaintext `--set-env-vars`.

Also create the dev uploads bucket:

```bash
gcloud storage buckets create gs://carrum-doc-ai-uploads-dev --project=carrum-doc-ai \
  --location=asia-southeast1 --uniform-bucket-level-access
```

### ⚠️ The real constraint: `max_connections`

`db-f1-micro` has 0.6 GB RAM and Cloud SQL caps it at roughly **25 connections**. Cloud Run scales to many instances, each with its own pool. Without limits you will exhaust connections long before you exhaust CPU.

Required settings:

- Application pool: **`max: 2`**, `idleTimeoutMillis: 10000`
- Cloud Run: **`--max-instances=8`**, `--min-instances=0`
- Worst case: 8 × 2 = 16 connections, leaving headroom for migrations and manual `psql`

If the service ever needs to scale past ~10 instances, move up to `db-g1-small` before raising `max-instances`. Treat this as a hard operational rule, not a tuning suggestion.

---

## 3. Locked decisions

| Choice | Decision | Why |
|---|---|---|
| Driver / query layer | **Drizzle ORM** + `drizzle-kit` | Schema-as-TypeScript mirrors the existing interfaces almost line-for-line; migrations generated and versioned; typed results catch column typos at compile time across ~44 ported functions. Raw SQL still available via ``db.execute(sql`…`)`` for the analytics aggregations |
| Migrations | `drizzle-kit generate` → committed SQL files, applied by an explicit `npm run db:migrate` | Never auto-migrate on boot; Cloud Run starts many instances concurrently |
| Local database | Docker Postgres 16 via `docker-compose.dev.yml` | Fast, offline, disposable — same migration files build both local and Cloud SQL, so schema never drifts |
| Deployed database | Cloud SQL Postgres 16 (`billparser-pg`, `billparser_dev` database), `db-f1-micro`, `asia-southeast1` | Same region as Cloud Run; smallest tier |
| Cloud Run → Cloud SQL | Unix socket via `--add-cloudsql-instances` | No VPC connector, no sidecar, fewest moving parts |
| Money columns | `NUMERIC`, with a `pg` type parser back to `number` | See §5.1 — this is a known footgun |
| Timestamps | `TIMESTAMPTZ` in the DB, converted to ISO string at the repository boundary | Correct storage, zero API change |
| Object storage | Unchanged — GCS. Only Firestore is being replaced | |
| `LOCAL_DEV` / `devStore` | Deleted entirely | Two implementations already disagree on filter/sort semantics; a third triples the bug surface. Docker Postgres removes the need for an in-memory mode |

---

## 4. Phase 2 — Branch setup ✅ DONE

```bash
git checkout dev && git pull
git checkout -b dev-pg
git merge origin/deepak_odo_fetaure   # clean, zero conflicts (verified with git merge-tree beforehand)
```

Baseline test run on `dev-pg`: 237/243 passing. The 6 failures (odometer OCR calling real APIs without mocks, and a pre-existing `NaN` cost-calc bug in `resolveKey.test.ts`) were confirmed present on `origin/dev` alone via an isolated worktree check — **not** introduced by the merge, not migration-blocking. Left alone for now.

---

## 5. Phase 3 — Schema

Eight Firestore collections become eight tables:

| Firestore collection | Postgres table |
|---|---|
| `bills` | `bills` |
| `bill_parts` | `bill_parts` |
| `users` | `users` |
| `api_keys` | `api_keys` |
| `token_transactions` | `token_transactions` |
| `vendors` | `vendors` |
| `settings/app_settings` (single doc) | `app_settings` (single row, `id` CHECK = 1) |
| `provider_credentials` | `provider_credentials` |

### 5.1 Type mapping rules

| Domain type | Postgres | Boundary conversion |
|---|---|---|
| ID strings (`bill_id`, `user_id`, …) | `TEXT PRIMARY KEY` | none — they are already UUIDv4 strings from `uuid()` |
| `created_at` / `updated_at` (ISO string) | `TIMESTAMPTZ NOT NULL` | `row.created_at.toISOString()` on read |
| Invoice amounts | `NUMERIC(14,2)` | parse to `number` |
| Tax / GST rates | `NUMERIC(6,3)` | parse to `number` |
| USD costs | `NUMERIC(12,6)` | parse to `number` |
| `token_balance` | `NUMERIC(12,4)` | parse to `number` |
| Token counts, latency ms | `INTEGER` / `BIGINT` | none |
| `confidence_score` | `REAL` | none |
| `review_reasons: string[]` | `TEXT[]` | none |
| `parsed_data: ParsedInvoiceData` | `JSONB` | none |
| `ocr_status`, `bill_type`, `line_type`, `role`, `status` | `TEXT` + `CHECK` constraint | none |

> **Footgun — read this.** `node-postgres` returns `NUMERIC` as a **string**, not a number. Left unhandled, `totalSpend += bill.grand_total_amount` silently produces string concatenation and every analytics figure becomes garbage. Register a global type parser once, at startup, before any query runs:
>
> ```ts
> import pg from 'pg';
> pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
> ```
>
> Add a test asserting `typeof bill.grand_total_amount === 'number'`. This is the highest-probability defect in the whole migration.

Use `TEXT` + `CHECK` for enums rather than native Postgres `ENUM` types — adding a new `BillType` later is then an ordinary migration instead of an `ALTER TYPE` dance.

### 5.2 Required extension

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

Needed for the substring search that replaces the Firestore prefix hack.

### 5.3 Indexes

These are not optional — they are what makes the migration a performance win rather than a lateral move.

```sql
-- bills: list + filter + sort
CREATE INDEX bills_updated_at_idx      ON bills (updated_at DESC);
CREATE INDEX bills_created_at_idx      ON bills (created_at DESC);
CREATE INDEX bills_status_updated_idx  ON bills (ocr_status, updated_at DESC);
CREATE INDEX bills_vehicle_idx         ON bills (vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX bills_vendor_idx          ON bills (vendor_id)  WHERE vendor_id  IS NOT NULL;

-- bills: duplicate detection
CREATE INDEX bills_dup_idx             ON bills (invoice_number, vendor_gstin)
                                       WHERE invoice_number IS NOT NULL;

-- bills: substring search (replaces the ⭐ prefix hack)
CREATE INDEX bills_vendor_trgm_idx     ON bills USING gin (vendor_name gin_trgm_ops);
CREATE INDEX bills_company_trgm_idx    ON bills USING gin (company_name gin_trgm_ops);
CREATE INDEX bills_invoice_trgm_idx    ON bills USING gin (invoice_number gin_trgm_ops);
CREATE INDEX bills_regno_trgm_idx      ON bills USING gin (registration_number gin_trgm_ops);

-- children and lookups
CREATE INDEX parts_bill_idx            ON bill_parts (bill_id);
CREATE INDEX parts_created_idx         ON bill_parts (created_at DESC);
CREATE UNIQUE INDEX users_email_idx    ON users (lower(email));
CREATE UNIQUE INDEX keys_hash_idx      ON api_keys (key_hash);
CREATE INDEX keys_user_idx             ON api_keys (user_id, created_at DESC);
CREATE INDEX tx_user_created_idx       ON token_transactions (user_id, created_at DESC);
CREATE INDEX vendors_gstin_idx         ON vendors (gstin) WHERE gstin IS NOT NULL;
CREATE INDEX vendors_pan_idx           ON vendors (pan)   WHERE pan   IS NOT NULL;
CREATE INDEX vendors_legalname_idx     ON vendors (lower(legal_name));
CREATE INDEX vendors_count_idx         ON vendors (invoice_count DESC);
```

### 5.4 Foreign keys

```sql
bill_parts.bill_id        → bills(bill_id)      ON DELETE CASCADE
api_keys.user_id          → users(user_id)      ON DELETE CASCADE
token_transactions.user_id→ users(user_id)      ON DELETE RESTRICT
bills.vendor_id           → vendors(vendor_id)  ON DELETE SET NULL
```

`ON DELETE CASCADE` on `bill_parts` lets `deleteBill` become a single statement — `deletePartsForBill` no longer needs to run first.

---

## 6. Phase 4 — Repository port

**~44 database functions across 6 files.** Nothing outside these files should need to change.

| File | Functions to port | Notes |
|---|---|---|
| `src/ocr/repository.ts` | 15 | The bulk of the work. 3 functions here are pure (`billNeedsReview`, `billMatchesSearch`, `extractPartsFromParsed`) — leave them alone |
| `src/users/repository.ts` | 12 | Crypto helpers are pure — leave alone |
| `src/vendor/vendorRepository.ts` | 8 | |
| `src/shared/settings.ts` | 6 | |
| `src/fraud/repository.ts` | 2 | |
| `src/analytics/repository.ts` | 1 | Delegates to OCR repo |

### 6.1 Functions that get *deleted*, not ported

These exist only to work around Firestore limitations:

- **`listAllBillsLean`** (`ocr/repository.ts:99`) — the whole cursor-batching, 25k-cap, in-flight-dedup, TTL-cache apparatus. Replaced by real SQL aggregates.
- **`AGG_MAX_DOCS` / `AGG_BATCH` / `PARTS_MAX` / `PARTS_BATCH` caps** — gone.
- **`searchBillsPaginated`** (`ocr/repository.ts:298`) — the `` range hack, the manual lower/upper-case duplication, the 4 parallel queries and in-memory merge. Becomes one `ILIKE` query.
- **`LEAN_BILL_FIELDS`** — column projection is just a `SELECT` list.
- **`src/shared/cache.ts`** — this exists to paper over Firestore read costs. Verify no other caller first, then remove. Re-add caching later only if a measured query is actually slow.
- **`src/shared/devStore.ts`** — deleted with `LOCAL_DEV`.
- Firestore half of **`src/config/firebase.ts`** — keep `storage()`, drop `db()` and `col()`.

### 6.2 Rewrites that fix real bugs

**`countAllStatuses`** — currently 7 separate Firestore `count()` calls plus a 25k-doc scan. Becomes one query:

```sql
SELECT ocr_status, COUNT(*) FROM bills GROUP BY ocr_status;
```

**`listBillsPaginated`** — currently loads up to 25,000 documents into memory to apply a status filter, because a composite index was missing (the code comment at `ocr/repository.ts:224` records that this returned HTTP 500 in production). Becomes an ordinary `WHERE … ORDER BY updated_at DESC LIMIT … OFFSET …` with a windowed `COUNT(*) OVER ()`.

**Analytics** (`computeKpis`, `getVehicleSpend`, `getCostPerKm`, `getOcrCostSummary`) — each currently pulls every bill and loops in JavaScript. Each becomes a `GROUP BY`. Port these to raw SQL via ``db.execute(sql`…`)``; do not try to express them in the query builder.

**`deductTokens`** (`users/service.ts:147`) — **this is a live race condition.** It reads the balance, checks it in JavaScript, then writes the new value. Two concurrent uploads both read the same balance and both succeed, letting a user overdraw. Postgres fixes it atomically:

```sql
UPDATE users
   SET token_balance    = token_balance - $2,
       total_tokens_used= total_tokens_used + $2,
       total_ocr_count  = total_ocr_count + 1,
       updated_at       = now()
 WHERE user_id = $1 AND token_balance >= $2
RETURNING *;
```

Zero rows returned ⇒ insufficient balance ⇒ HTTP 402. Wrap this and the `token_transactions` insert in one transaction so the ledger can never disagree with the balance. `trackOcrCost` has the same read-modify-write flaw and takes the same treatment.

**`getUserTransactions`** — the comment at `users/repository.ts:209` says it skips `orderBy` "to avoid requiring a Firestore composite index" and sorts in memory instead. Becomes a plain `ORDER BY created_at DESC LIMIT $2`.

**`searchVendors`** — currently fetches 1,000 vendors and filters in JavaScript. Becomes `ILIKE` across the four columns.

### 6.3 Suggested order of work

Port in dependency order, committing and running `npm test` after each:

1. `config/db.ts` — pool, type parsers, graceful shutdown
2. Drizzle schema + first generated migration
3. `shared/settings.ts` — smallest, proves the pattern end to end
4. `vendor/vendorRepository.ts`
5. `users/repository.ts` + the `deductTokens` transaction fix
6. `ocr/repository.ts` — the big one
7. `fraud/repository.ts`, `analytics/repository.ts` + SQL aggregates
8. Delete `devStore`, `LOCAL_DEV`, `cache.ts`, Firestore half of `firebase.ts`
9. `env.ts` — drop `firestorePrefix` / `firestoreDatabaseId`, add `databaseUrl`

---

## 7. Phase 5 — Test safety net

**Today: 30 test files, zero touch the data layer.** They are all pure-function tests (normalize, validate, mappers, parsers) — they will keep passing throughout and prove nothing about the migration.

Before deleting any Firestore code, add **repository contract tests** — one per repository, exercising every function against a real Postgres (Docker, or `pg-mem` for speed). At minimum:

- Round-trip: create → get → update → list → delete for each table
- `findDuplicateBills` matches on invoice number, respects `excludeId`, honours the optional GSTIN filter
- `listBillsPaginated`: page boundaries, each filter mode, `total` correctness
- Search: substring match (not just prefix), case-insensitive, all four fields
- **Concurrency:** fire 10 parallel `deductTokens` at a balance that covers 5 — exactly 5 must succeed. This test fails on the current Firestore code; it must pass after
- Type assertion: every numeric field returns `typeof === 'number'` (guards the `NUMERIC`-as-string footgun)
- `ON DELETE CASCADE`: deleting a bill removes its parts

These tests are the deliverable that makes the rest safe. Do not skip them to save time.

---

## 8. Phase 6 — Deployment

`cloudbuild-dev.yaml` needs these changes:

- Substitutions: `_RUNTIME_SA` → `billparser-runtime@carrum-doc-ai.iam.gserviceaccount.com`; `_STORAGE_BUCKET` → `carrum-doc-ai-uploads-dev`; drop `_FIRESTORE_DB`
- Remove `FIRESTORE_DATABASE_ID` and `LOCAL_DEV` from `--set-env-vars`
- Add `--add-cloudsql-instances=carrum-doc-ai:asia-southeast1:billparser-pg`
- Add `--set-secrets=DATABASE_URL=billparser-db-url-dev:latest`
- Add `--max-instances=8` (see §2)
- Add a migration step **before** `deploy-platform` that runs `npm run db:migrate` against `billparser_dev`

The runtime service account needs `roles/cloudsql.client` and `roles/secretmanager.secretAccessor`.

Also update `docker-compose.yml` (add a `postgres` service, drop the Firestore env vars) and `RUN.md`, which currently documents `LOCAL_DEV=true` and the old `providers/` file paths that no longer exist after the recent refactor.

---

## 9. Behaviour changes to expect

These are **corrections**, but they will look like regressions to anyone watching the dashboards. Communicate them before deploying.

| What changes | Why |
|---|---|
| Analytics totals, counts, cost-per-km, fraud hits all shift | The 25,000-document cap disappears; aggregates now cover the full table |
| Filtered list `total` values change | Real `COUNT(*)` instead of a count derived from the capped scan |
| Search returns more results | Substring matching replaces prefix-only matching |
| Deep pagination gets much faster | Firestore `.offset()` bills for every skipped document; Postgres does not |
| Analytics page stops being stale for up to 5 minutes | The TTL cache is gone; reads are live |
| A user can no longer overdraw their balance | The `deductTokens` race is fixed |

Since the database starts empty, none of this is observable until real invoices are processed — which makes `dev-pg` a comfortable place to validate before anyone depends on the numbers.

---

## 10. Rollback

`dev` is untouched and still points at `carrum-agent-pilot-dev`. Rollback is `git checkout dev` plus a redeploy of the old Cloud Build config. The new project and its Cloud SQL instance can be deleted independently. There is no shared state between old and new at any point.

---

## 11. Execution checklist

- [x] `git checkout -b dev-pg` from `dev`; merge `origin/deepak_odo_fetaure`; baseline test run confirmed (§4)
- [x] APIs enabled in `carrum-doc-ai`; `billparser-runtime` service account created
- [ ] Cloud SQL instance `billparser-pg` (`--edition=ENTERPRISE`, `db-f1-micro`) — **in progress**
- [ ] `billparser_dev` database + `billparser_app_dev` role + `billparser-db-url-dev` secret
- [ ] `carrum-doc-ai-uploads-dev` bucket + IAM binding for runtime SA
- [ ] `docker-compose.dev.yml` with Postgres 16; `.env.example` updated with `DATABASE_URL`
- [ ] Install `drizzle-orm`, `drizzle-kit`, `pg`, `@types/pg`
- [ ] `src/config/db.ts` — pool (`max: 2`), **`NUMERIC` type parser**, shutdown hook (§5.1)
- [ ] Drizzle schema for 8 tables; generate + apply first migration (§5)
- [ ] Indexes and foreign keys applied (§5.3, §5.4)
- [ ] Repository contract tests written and passing against Postgres (§7)
- [ ] Port the 6 repository files in the order given (§6.3)
- [ ] `deductTokens` / `trackOcrCost` converted to atomic SQL; concurrency test passes (§6.2)
- [ ] Analytics + fraud rewritten as `GROUP BY` (§6.2)
- [ ] Delete `devStore.ts`, `LOCAL_DEV`, `cache.ts`, `db()`/`col()` from `firebase.ts`; keep `storage()` (§6.1)
- [ ] `grep -rn "firestore\|firebase-admin/firestore\|devStore\|LOCAL_DEV" platform/src` returns **only** the storage import
- [ ] `npm run lint` (`tsc --noEmit`) and `npm test` green
- [ ] `cloudbuild-dev.yaml` updated; migration step added before deploy (§8)
- [ ] Deploy to `carrum-doc-ai`; verify `/api/health`, upload one invoice end to end, check analytics and fraud pages render
- [ ] `RUN.md` rewritten (it is already stale re: `providers/` paths and `LOCAL_DEV`)
