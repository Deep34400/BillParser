# Database Design — BillParser Platform

> **ORM:** Sequelize 6 · **Database:** PostgreSQL 15+ · **Extension:** pg_trgm (trigram search)
> **Tables:** users, vendors, bills, bill_parts, api_keys, token_transactions, app_settings, provider_credentials, audit_logs, webhook_endpoints

---

## Entity Relationship Diagram

```
┌─────────────────┐         ┌──────────────────────────────────────┐
│    vendors       │ 1    N  │               bills                  │
│─────────────────│◄────────│──────────────────────────────────────│
│ vendor_id  PK   │         │ bill_id         PK                   │
│ legal_name      │         │ vendor_id       FK → vendors (NULL)  │
│ display_name    │         │ bill_type       NOT NULL              │
│ gstin           │         │ ocr_status      NOT NULL              │
│ pan             │         │ vendor_name, vendor_gstin             │
│ invoice_count   │         │ vendor_name, vendor_gstin             │
│ first_seen      │         │ invoice_number, invoice_date          │
│ last_seen       │         │ grand_total_amount, parts_amount ...  │
│ parser_name     │         │ parsed_data     JSONB                 │
│ created_at      │         │ total_reconciliation  JSONB           │
│ updated_at      │         │ fallback_history      JSONB           │
└─────────────────┘         │ extraction_*, structuring_* (costs)   │
                            │ schema_version, created_at, updated_at│
                            └───────────────┬──────────────────────┘
                                            │ 1
                                            │
                                            │ N (CASCADE)
                            ┌───────────────▼──────────────────────┐
                            │           bill_parts                  │
                            │──────────────────────────────────────│
                            │ part_id       PK                      │
                            │ bill_id       FK → bills (CASCADE)    │
                            │ line_type     PART | LABOUR           │
                            │ name, quantity, rate, amount           │
                            │ hsn_sac_code, tax_percentage           │
                            │ created_at                             │
                            └──────────────────────────────────────┘

┌─────────────────┐         ┌──────────────────────────────────────┐
│     users        │ 1    N  │            api_keys                  │
│─────────────────│◄────────│──────────────────────────────────────│
│ user_id    PK   │         │ key_id        PK                     │
│ email    UNIQUE │         │ user_id       FK → users (CASCADE)   │
│ name            │         │ key_hash      UNIQUE                 │
│ password_hash   │         │ key_prefix                            │
│ role            │         │ label                                 │
│ status          │         │ created_at, last_used_at              │
│ api_key_hash    │         └──────────────────────────────────────┘
│ api_key_prefix  │
│ token_balance   │         ┌──────────────────────────────────────┐
│ total_tokens    │ 1    N  │       token_transactions              │
│ total_ocr_count │◄────────│──────────────────────────────────────│
│ total_cost_usd  │         │ tx_id         PK                     │
│ intake_email    │         │ user_id       FK → users (RESTRICT)  │
│ created_at      │         │ type          credit | debit          │
│ updated_at      │         │ amount                                │
│                 │         │ balance_after                         │
│                 │         │ description                           │
│                 │         │ reference_id                          │
│                 │         │ created_at                            │
│                 │         └──────────────────────────────────────┘
│                 │
│                 │ 1    N  ┌──────────────────────────────────────┐
│                 │◄────────│           audit_logs                  │
│                 │         │──────────────────────────────────────│
│                 │         │ log_id        PK                     │
│                 │         │ user_id       (nullable)             │
│                 │         │ action        invoice:upload …       │
│                 │         │ resource_type / resource_id          │
│                 │         │ details       JSONB                  │
│                 │         │ created_at                           │
│                 │         └──────────────────────────────────────┘
│                 │
│                 │ 1    N  ┌──────────────────────────────────────┐
│                 │◄────────│        webhook_endpoints              │
│                 │         │──────────────────────────────────────│
│                 │         │ endpoint_id   PK                     │
│                 │         │ user_id                              │
│                 │         │ url, events[], secret                │
│                 │         │ active, description                  │
│                 │         │ created_at, updated_at               │
│                 │         └──────────────────────────────────────┘
└─────────────────┘

┌──────────────────────────┐    ┌──────────────────────────────────┐
│      app_settings         │    │     provider_credentials          │
│──────────────────────────│    │──────────────────────────────────│
│ id = 1        PK         │    │ provider       PK                 │
│ pipeline_mode            │    │ credentials    JSONB              │
│ extraction_provider      │    └──────────────────────────────────┘
│ structuring_provider     │
│ structuring_model        │
│ fallback_chain    JSONB  │
│ model_pricing     JSONB  │
│ usd_to_inr               │
│ thinking_budget           │
└──────────────────────────┘
```

---

## Tables in Detail

### 1. `vendors` — Vendor Registry

Auto-populated from processed invoices. Matched by GSTIN → PAN → legal name.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `vendor_id` | TEXT | **PK** | UUID |
| `legal_name` | TEXT | | Company name from invoice |
| `display_name` | TEXT | | Customizable display name |
| `gstin` | TEXT | Indexed | GST Identification Number |
| `pan` | TEXT | Indexed | Permanent Account Number |
| `invoice_count` | INTEGER | NOT NULL, default 0 | Total invoices processed |
| `first_seen` | TIMESTAMPTZ | NOT NULL | First invoice date |
| `last_seen` | TIMESTAMPTZ | NOT NULL | Most recent invoice |
| `parser_name` | TEXT | | Future: vendor-specific parser (e.g. `bosch_v1`) |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**Indexes:**
- `vendors_gstin_idx` — exact GSTIN lookup
- `vendors_pan_idx` — exact PAN lookup
- `vendors_legalname_idx` — `lower(legal_name)` for case-insensitive match
- `vendors_count_idx` — `invoice_count DESC` for top vendors

---

### 2. `bills` — The Core Invoice Table

One row per uploaded invoice. Contains all extracted data, costs, and audit fields.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| **Identity** | | | |
| `bill_id` | TEXT | **PK** | UUID |
| `fleet_id` | TEXT | | Fleet identifier |
| `vehicle_id` | TEXT | Indexed | Vehicle identifier |
| `bill_type` | TEXT | NOT NULL, CHECK | MAINTENANCE, FUEL, INSURANCE, TYRE, TOLL, ACCIDENT_REPAIR, BATTERY_REPLACEMENT, AMC_CONTRACT, OTHER |
| `bill_category` | TEXT | | Sub-category |
| **Vendor** | | | |
| `vendor_name` | TEXT | | Company name from OCR |
| `vendor_gstin` | TEXT | | Seller GSTIN from OCR |
| `vendor_id` | TEXT | FK → vendors, SET NULL | Matched vendor record |
| **Tax Identity** | | | |
| `company_name` | TEXT | | Same as vendor_name (from parsed_data) |
| `gstin` | TEXT | | GSTIN on invoice |
| `pan` | TEXT | | PAN (derived from GSTIN middle 10 chars) |
| `irn` | TEXT | | e-Invoice Reference Number |
| **Invoice Details** | | | |
| `invoice_number` | TEXT | | Invoice number |
| `invoice_date` | TEXT | | Date as printed (DD/MM/YYYY etc.) |
| `invoice_time` | TEXT | | Time as printed |
| **Amounts** (all NUMERIC 14,2) | | | |
| `subtotal_amount` | NUMERIC(14,2) | | sub_total_calculated |
| `parts_amount` | NUMERIC(14,2) | | Parts total |
| `labour_amount` | NUMERIC(14,2) | | Labour total |
| `grand_total_amount` | NUMERIC(14,2) | | Grand total |
| `deductibles` | NUMERIC(14,2) | | Deductible amount |
| `salvage` | NUMERIC(14,2) | | Salvage value |
| **GST — Parts** | | | |
| `parts_cgst_amount` | NUMERIC(14,2) | | Parts CGST ₹ |
| `parts_sgst_amount` | NUMERIC(14,2) | | Parts SGST ₹ |
| `parts_igst_amount` | NUMERIC(14,2) | | Parts IGST ₹ |
| `parts_cgst_rate` | NUMERIC(6,3) | | Parts CGST % |
| `parts_sgst_rate` | NUMERIC(6,3) | | Parts SGST % |
| `parts_igst_rate` | NUMERIC(6,3) | | Parts IGST % |
| **GST — Labour** | | | |
| `labour_cgst_amount` | NUMERIC(14,2) | | Labour CGST ₹ |
| `labour_sgst_amount` | NUMERIC(14,2) | | Labour SGST ₹ |
| `labour_igst_amount` | NUMERIC(14,2) | | Labour IGST ₹ |
| `labour_cgst_rate` | NUMERIC(6,3) | | Labour CGST % |
| `labour_sgst_rate` | NUMERIC(6,3) | | Labour SGST % |
| `labour_igst_rate` | NUMERIC(6,3) | | Labour IGST % |
| `total_tax_amount` | NUMERIC(14,2) | | Sum of all GST |
| **Vehicle** | | | |
| `odometer_reading` | INTEGER | | Mileage reading |
| `registration_number` | TEXT | | Vehicle registration |
| `chassis_number` | TEXT | | Chassis number |
| **Status & Quality** | | | |
| `ocr_status` | TEXT | NOT NULL, CHECK | DRAFT, UPLOADED, PROCESSING, OCR_COMPLETED, NEED_REVIEW, VERIFIED, FAILED |
| `processing_status` | TEXT | | Error message on failure |
| `confidence_score` | REAL | | 0–1 extraction confidence |
| `review_reasons` | TEXT[] | | Human-readable review flags |
| `review_codes` | TEXT[] | | Machine-readable codes: MISSING_TAX_ID, TOTAL_MISMATCH, etc. |
| `total_reconciliation` | JSONB | | Reconciliation result |
| `fallback_attempts` | INTEGER | | Number of fallback retries |
| `fallback_history` | JSONB | | Array of fallback attempt details |
| **Storage** | | | |
| `file_url` | TEXT | | Public file URL |
| `storage_path` | TEXT | | Cloud Storage path |
| `raw_ocr_reference` | TEXT | | First 10KB of raw OCR markdown |
| `parsed_data` | JSONB | | **IMMUTABLE** — complete OCR response |
| `pipeline_mode` | TEXT | | `single` or `split` |
| **Cost Audit** | | | |
| `extraction_cost_usd` | NUMERIC(18,10) | | OCR extraction cost |
| `structuring_cost_usd` | NUMERIC(18,10) | | AI structuring cost |
| `total_cost_usd` | NUMERIC(18,10) | | Total processing cost |
| `extraction_tokens` | INTEGER | | OCR tokens used |
| `extraction_input_tokens` | INTEGER | | |
| `extraction_output_tokens` | INTEGER | | |
| `structuring_tokens` | INTEGER | | |
| `structuring_input_tokens` | INTEGER | | |
| `structuring_output_tokens` | INTEGER | | |
| `total_tokens` | INTEGER | | |
| `total_input_tokens` | INTEGER | | |
| `total_output_tokens` | INTEGER | | |
| `total_thinking_tokens` | INTEGER | | Gemini reasoning tokens |
| `total_input_cost_usd` | NUMERIC(18,10) | | Input token cost |
| `total_output_cost_usd` | NUMERIC(18,10) | | Output token cost |
| `extraction_provider` | TEXT | | e.g. `mistral`, `gemini` |
| `structuring_provider` | TEXT | | |
| `extraction_model` | TEXT | | e.g. `mistral-ocr-latest` |
| `structuring_model` | TEXT | | e.g. `gemini-2.5-flash` |
| `extraction_latency_ms` | INTEGER | | OCR API time |
| `structuring_latency_ms` | INTEGER | | Structuring API time |
| `total_latency_ms` | INTEGER | | Total pipeline time |
| `extraction_pages` | INTEGER | | Pages processed (Mistral OCR) |
| `input_rate_per_1m` | NUMERIC(18,10) | | $/1M input tokens at processing time |
| `output_rate_per_1m` | NUMERIC(18,10) | | $/1M output tokens at processing time |
| `fx_rate_usd_inr` | NUMERIC(10,4) | | Frozen USD→INR at processing time |
| **Meta** | | | |
| `schema_version` | INTEGER | NOT NULL | Currently 1 |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**Indexes:**
- `bills_updated_at_idx` — `updated_at DESC` (pagination default sort)
- `bills_created_at_idx` — `created_at DESC` (date range queries)
- `bills_status_updated_idx` — `(ocr_status, updated_at DESC)` (filtered pagination)
- `bills_vehicle_idx` — `vehicle_id` (vehicle analytics)
- `bills_vendor_idx` — `vendor_id` (vendor drilldown)
- `bills_dup_idx` — `(invoice_number, vendor_gstin)` (duplicate detection)

**GST Rules:**
- Intra-state: CGST + SGST (IGST = NULL)
- Inter-state: IGST only (CGST = SGST = NULL)
- Values stored as-is from OCR — never recalculated
- `parsed_data` is the immutable source of truth

---

### 5. `bill_parts` — Line Items

One row per part or labour line item. Cascade-deleted when parent bill is removed.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `part_id` | TEXT | **PK** | UUID |
| `bill_id` | TEXT | **FK → bills**, CASCADE | Parent invoice |
| `line_type` | TEXT | NOT NULL, CHECK | `PART` or `LABOUR` |
| `name` | TEXT | | Item description |
| `description` | TEXT | | Same as name |
| `quantity` | NUMERIC(12,3) | | Qty (always 1 for labour) |
| `rate` | NUMERIC(14,2) | | Unit rate |
| `amount` | NUMERIC(14,2) | | Line total (taxable amount) |
| `tax_percentage` | NUMERIC(6,3) | | GST % for this line |
| `tax_amount` | NUMERIC(14,2) | | Tax on this line |
| `part_number` | TEXT | | Part code / labour code |
| `hsn_sac_code` | TEXT | | HSN/SAC code |
| `manufacturer` | TEXT | | Future: part manufacturer |
| `normalized_name` | TEXT | | Future: normalized for analytics |
| `confidence_score` | REAL | | Line-level confidence |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

**Indexes:**
- `parts_bill_idx` — `bill_id` (join to parent)
- `parts_created_idx` — `created_at DESC`

---

### 6. `users` — Authentication & Billing

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `user_id` | TEXT | **PK** | UUID |
| `email` | TEXT | NOT NULL, UNIQUE (lower) | Login email |
| `name` | TEXT | NOT NULL | Display name |
| `password_hash` | TEXT | NOT NULL | scrypt hash (`salt:hash`) |
| `role` | TEXT | NOT NULL, CHECK | `admin` or `user` |
| `status` | TEXT | NOT NULL, CHECK | `active` or `blocked` |
| `api_key_hash` | TEXT | NOT NULL | Legacy API key hash |
| `api_key_prefix` | TEXT | NOT NULL | Legacy API key prefix |
| `token_balance` | NUMERIC(12,4) | NOT NULL | Available token balance |
| `total_tokens_used` | NUMERIC(14,4) | NOT NULL | Lifetime tokens consumed |
| `total_ocr_count` | INTEGER | NOT NULL | Lifetime OCR count |
| `total_cost_usd` | NUMERIC(18,10) | NOT NULL | Lifetime USD cost |
| `intake_email` | TEXT | | Email intake sender address |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**Indexes:**
- `users_email_idx` — UNIQUE on `lower(email)`

---

### 7. `api_keys` — Multi-Key Authentication

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `key_id` | TEXT | **PK** | UUID |
| `user_id` | TEXT | **FK → users**, CASCADE | Owner |
| `key_hash` | TEXT | NOT NULL, UNIQUE | SHA-256 hash |
| `key_prefix` | TEXT | NOT NULL | First 8 chars (display) |
| `label` | TEXT | NOT NULL | User-assigned label |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `last_used_at` | TIMESTAMPTZ | | Last API call timestamp |

**Indexes:**
- `keys_hash_idx` — UNIQUE on `key_hash` (auth lookup)
- `keys_user_idx` — `(user_id, created_at DESC)` (list user's keys)

---

### 8. `token_transactions` — Billing Ledger

Append-only audit log. Every credit/debit creates a row.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `tx_id` | TEXT | **PK** | UUID |
| `user_id` | TEXT | **FK → users**, RESTRICT | Can't delete user with history |
| `type` | TEXT | NOT NULL, CHECK | `credit` or `debit` |
| `amount` | NUMERIC(14,4) | NOT NULL | Token amount |
| `balance_after` | NUMERIC(12,4) | NOT NULL | Balance snapshot |
| `description` | TEXT | NOT NULL | Human-readable reason |
| `reference_id` | TEXT | | e.g. bill_id for OCR debits |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

**Indexes:**
- `tx_user_created_idx` — `(user_id, created_at DESC)` (transaction history)

**Race condition protection:** Token debits use an atomic `UPDATE ... WHERE token_balance >= amount` inside a Sequelize transaction. Two concurrent OCR uploads cannot both pass the balance check.

---

### 9. `app_settings` — Singleton Configuration

Single row (`id = 1`). Stores pipeline config, pricing, and email intake settings.

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER | **PK**, always 1 |
| `pipeline_mode` | TEXT | `single` or `split` |
| `extraction_provider` | TEXT | e.g. `mistral` |
| `structuring_provider` | TEXT | e.g. `gemini` |
| `structuring_model` | TEXT | e.g. `gemini-2.5-flash` |
| `extraction_model` | TEXT | Override extraction model |
| `single_provider` | TEXT | Single-mode provider |
| `single_model` | TEXT | Single-mode model |
| `fallback_chain` | JSONB | Ordered fallback levels |
| `model_pricing` | JSONB | Per-model $/1M token overrides |
| `usd_to_inr` | NUMERIC(10,4) | Exchange rate for ₹ display |
| `thinking_budget` | INTEGER | Gemini reasoning token cap |
| `mistral_ocr_price_per_1k_pages` | NUMERIC(10,4) | Mistral OCR page price |
| `email_intake_enabled` | BOOLEAN | |
| `email_intake_user` | TEXT | IMAP mailbox |
| `email_intake_poll_interval_sec` | INTEGER | Poll interval |
| `email_intake_allowed_senders` | TEXT[] | Whitelist |

---

### 10. `provider_credentials` — API Keys per Provider

| Column | Type | Description |
|--------|------|-------------|
| `provider` | TEXT | **PK** — e.g. `mistral`, `gemini`, `openai` |
| `credentials` | JSONB | `{ "apiKey": "...", "endpoint": "..." }` |

---

### 11. `audit_logs` — Activity History

Append-only. Written by `audit()` from invoice, admin, and webhook code. The UI reads this table; it is not derived from invoices.

See [src/audit/README.md](./src/audit/README.md).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `log_id` | TEXT | **PK** | UUID |
| `user_id` | TEXT | | Actor (nullable for system rows) |
| `action` | TEXT | NOT NULL | e.g. `invoice:upload`, `invoice:approve`, `tokens:credit` |
| `resource_type` | TEXT | | `bill`, `user`, `webhook` |
| `resource_id` | TEXT | | Target id |
| `details` | JSONB | | Extra context (`fileName`, `reason`, …) |
| `ip_address` | TEXT | | Reserved |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

**Indexes:**
- `audit_user_created_idx` — `(user_id, created_at DESC)`
- `audit_action_idx` — `action`
- `audit_resource_idx` — `(resource_type, resource_id)`

---

### 12. `webhook_endpoints` — Outbound Event Subscriptions

Per-user HTTPS receivers. Dispatch is fire-and-forget HMAC POST.

See [src/webhook/README.md](./src/webhook/README.md).

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `endpoint_id` | TEXT | **PK** | UUID |
| `user_id` | TEXT | NOT NULL | Owner — only that user's invoice events are sent here |
| `url` | TEXT | NOT NULL | Receiver (`https://` in production) |
| `events` | TEXT[] | NOT NULL | Subset of `invoice.uploaded`, `.completed`, `.failed`, `.approved`, `.rejected`, `.deleted` |
| `secret` | TEXT | NOT NULL | `whsec_…` used for `X-Webhook-Signature` |
| `active` | BOOLEAN | NOT NULL, default true | Paused endpoints are skipped |
| `description` | TEXT | | Optional label |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

**Indexes:**
- `webhooks_user_idx` — `user_id`
- `webhooks_active_idx` — `active`

---

## Foreign Key Relationships

| From | To | On Delete | Why |
|------|----|-----------|-----|
| `bills.vendor_id` | `vendors.vendor_id` | SET NULL | Vendor is optional; deleting vendor doesn't delete bills |
| `bill_parts.bill_id` | `bills.bill_id` | CASCADE | Parts are owned by a bill; no orphans |
| `api_keys.user_id` | `users.user_id` | CASCADE | Keys are owned by a user |
| `token_transactions.user_id` | `users.user_id` | RESTRICT | Can't delete user with billing history |
| `audit_logs.user_id` | — | none | Actor id stored as text (no FK; keep history if a user is removed) |
| `webhook_endpoints.user_id` | — | none | Owner id stored as text |

---

## Schema Management

- **ORM:** Sequelize 6 with `sync({ alter: true })` on startup
- **Init order:** Vendor → User → Bill → BillPart → ApiKey → TokenTransaction → AppSettings → ProviderCredential → AuditLog → WebhookEndpoint
- **Extension:** `pg_trgm` created automatically for trigram search
- **NUMERIC handling:** pg type parser overrides OID 1700 → `parseFloat()` so all decimal columns return JS numbers (not strings)
- **Timestamps:** Managed by application code, not Sequelize auto-timestamps
- **Column naming:** Model attributes are camelCase; DB columns are snake_case via `field:` mapping

---

## Connection Pool

```
max: 2          ← per Cloud Run instance (2 × 8 instances = 16 total)
min: 0          ← idle connections released
idle: 10,000ms  ← close idle connections after 10s
acquire: 30,000ms ← timeout waiting for connection
```
