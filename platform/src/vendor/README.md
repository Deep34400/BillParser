# Vendor Registry Module

Automatically builds a vendor directory from processed invoices. Vendors are stored in PostgreSQL via Sequelize models defined in `vendor/models/`.

## Directory Structure

```
vendor/
├── models/
│   ├── vendor.ts            # Vendor Sequelize model
│   └── index.ts             # Barrel
├── vendorRepository.ts      # PostgreSQL CRUD (Sequelize)
├── vendorService.ts         # Matching + upsert
├── vendorMapper.ts          # Extract fields from ParsedInvoiceData
├── vendorTypes.ts           # VendorDoc interface
├── route.ts                 # API endpoints
└── README.md
```

## How It Works

```
OCR finishes (bill status = OCR_COMPLETED)
         │
         ▼
route.ts calls upsertVendorFromInvoice(billId, parsedData)
         │  (fire-and-forget — never blocks OCR pipeline)
         │
         ▼
vendorMapper extracts: company_name → legal_name, gstin, pan
         │
         ▼
vendorService matches existing vendor by priority:
         │  1. GSTIN (exact)
         │  2. PAN (exact)
         │  3. Legal Name (case-insensitive)
         │
    ┌────┴────┐
    ▼         ▼
  Found     Not Found
    │         │
    ▼         ▼
  Update    Create new
  count     VendorDoc
  + date
    │         │
    └────┬────┘
         ▼
  vendor_id written back to bill row (via OCR repository)
```

## Architecture

| File | Role |
|------|------|
| `models/vendor.ts` | Vendor Sequelize model — maps to `vendors` table |
| `models/index.ts` | Barrel export |
| `vendorTypes.ts` | `VendorDoc` interface (domain shape) |
| `vendorMapper.ts` | Extract vendor fields from `ParsedInvoiceData` |
| `vendorRepository.ts` | Sequelize CRUD + lookup helpers for `vendors` |
| `vendorService.ts` | Matching priority + upsert logic |
| `route.ts` | API endpoints: `GET /api/vendors`, `GET /api/vendors/:id` |

## PostgreSQL Table: `vendors`

| Field | Type | Description |
|-------|------|-------------|
| `vendor_id` | string | Primary key (UUID) |
| `legal_name` | string | Company name from invoice |
| `display_name` | string | Same as legal_name (customizable later) |
| `gstin` | string | GST Identification Number |
| `pan` | string | Permanent Account Number |
| `invoice_count` | number | Total invoices from this vendor |
| `first_seen` | string | ISO timestamp of first invoice |
| `last_seen` | string | ISO timestamp of most recent invoice |
| `parser_name` | string | Future: vendor-specific parser (e.g. `bosch_v1`) |
| `created_at` | string | Record creation timestamp |
| `updated_at` | string | Last update timestamp |

The Sequelize model in `models/vendor.ts` handles column name mapping (`vendorId` ↔ `vendor_id`, etc.). Repository functions convert between Sequelize rows and `VendorDoc`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/vendors` | List vendors (search with `?q=`) |
| GET | `/api/vendors/:id` | Single vendor detail |

## Integration Point

The vendor upsert is called from `ocr/route.ts` **after** OCR completes:

```
upsertVendorFromInvoice(billId, parsed)
  .then(vid => updateBill(billId, { vendor_id: vid }))
  .catch(...)  // fire-and-forget
```

This is the ONLY touch point with the OCR module. The vendor module never calls any OCR function — it only consumes the already-produced `ParsedInvoiceData`.

## Future: Vendor-Specific Parsers

The `parser_name` field is reserved for future vendor-specific parsing logic:

- `bosch_v1` — Bosch service center invoices
- `toyota_v1` — Toyota dealer invoices
- `maruti_v1` — Maruti Suzuki invoices

Not implemented yet. When ready, set `parser_name` on the vendor and the OCR post-processing can use it to apply vendor-specific extraction rules.
