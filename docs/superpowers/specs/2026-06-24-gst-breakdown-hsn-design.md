# GST tax breakdown + HSN/SAC

**Date:** 2026-06-24
**Status:** Approved

## Goal

Capture and display the full Indian GST invoice summary and per-line HSN/SAC
codes. The detail view's totals should read, in order: Sub Total → Less
Discounts → CGST → SGST/IGST → Sub Total (incl. tax) → Net Bill Amount. The
line-item table should include an HSN/SAC column.

Driven by the example invoice `cmqrh0nby000228w17xrl4p0j`, whose raw OCR shows:

```
Sub Total Amount         : 2,666.00
Less Discount ...        :   266.60
CGST @ 9%                :   215.95
SGST @ 9%                :   215.95
Sub Total Amount         : 2,831.30   (= 2666 - 266.60 + 215.95 + 215.95)
Net Bill Amount (Rounded): 3,997.00
```

## Field model

| Display row            | Field            | Notes                                  |
|------------------------|------------------|----------------------------------------|
| Sub Total (1st)        | `subtotal`       | existing; pre-discount line total      |
| Less Discounts         | `discountAmount` | new                                    |
| CGST                   | `cgstAmount`     | new                                    |
| SGST / IGST            | `sgstAmount` / `igstAmount` | new; mutually exclusive     |
| Sub Total (2nd)        | `totalAmount`    | existing; subtotal − discount + tax    |
| Net Bill Amount        | `netAmount`      | new; rounded final payable             |

`taxAmount` (existing) is kept = CGST + SGST + IGST, for analytics/back-compat.
All new columns are nullable; existing invoices are unaffected until re-extracted.

## Data model (Prisma)

- `LineItem`: add `hsnSac String?`.
- `Invoice`: add `discountAmount Float?`, `cgstAmount Float?`, `sgstAmount
  Float?`, `igstAmount Float?`, `netAmount Float?`.
- One additive migration (`prisma migrate dev`). The api container runs
  `migrate deploy` on startup.

## Extraction

- `CanonicalLineItem`: add `hsnSac?: string`.
- `CanonicalResult`: add `discountAmount?`, `cgstAmount?`, `sgstAmount?`,
  `igstAmount?`, `netAmount?` (all `number`).
- `STRUCTURING_PROMPT` (markdown providers — Ollama/Mistral/LlamaParse): extend
  the JSON schema with `hsnSac` per line item and the five new invoice-level
  fields. Instruct: SGST and IGST are mutually exclusive (intra- vs inter-state
  — populate whichever the invoice shows, null the other); `netAmount` is the
  final rounded payable.
- `normalizeStructured`: map/coerce the new fields with the existing
  `toNum`/`toStr` helpers.
- Structured mappers (`azure`, `textract`): populate from provider output where
  available (e.g. azure `TotalTax`/`SubTotal` already map). Leave GST-split and
  HSN null when the provider does not expose them — no fabrication.

## Persistence

Thread the new fields through every place canonical fields are written:

- `extraction/run.ts` — when writing the Invoice and its LineItems from a run.
- apply-run snapshot/restore (`routes/invoices.ts` apply-run + the
  `fieldsSnapshot`/`itemsSnapshot` shapes).
- `PATCH /api/invoices/:id` — accept and persist the new invoice fields and
  per-line `hsnSac`.

## UI

### `InvoiceDetailPage`

- **LineItemTable**: add an **HSN/SAC** column after SKU (read view + the
  `numS`/`tdS` styling already present). Render `—` when null.
- **Totals footer**: replace the Subtotal/Tax/Total block with an ordered list,
  each row rendered only when its value is non-null:
  1. Sub Total — `subtotal`
  2. Less Discounts — `discountAmount`
  3. CGST — `cgstAmount`
  4. SGST — `sgstAmount` **or** IGST — `igstAmount` (whichever is non-null)
  5. Sub Total — `totalAmount`
  6. **Net Bill Amount** — `netAmount` (bold, emphasized)

  Back-compat fallback: if none of `cgstAmount`/`sgstAmount`/`igstAmount` is
  present but `taxAmount` is, show a single "Tax" row. If `netAmount` is null,
  the final emphasized row falls back to `totalAmount`.
- **FieldGrid declutter**: remove the Subtotal / Tax / Total cells (now shown in
  the footer). Remaining: Invoice #, PO #, Invoice date, Due date, Currency,
  Provider, Extraction cost, Structuring cost, Total cost, Confidence.
- **Edit mode**: add a per-line **HSN/SAC** input, and invoice-level inputs for
  discount / CGST / SGST / IGST / net. `saveEdit` includes them in the PATCH
  body; `enterEdit` seeds them; `EditLineItem` gains `hsnSac`.

### `CompareOverlay`

- Add the HSN/SAC column to its line-item table and the same ordered totals
  breakdown, for parity with the detail view.

### `InvoicesPage` (ledger)

- TOTAL column uses `netAmount ?? totalAmount` so the payable stays correct for
  old and new invoices.

## CSV export

- Header CSV: add `discount`, `cgst`, `sgst`, `igst`, `net` columns.
- Line-item CSV: add `hsnSac`.
- (Inspect `lib/csv.ts` column lists and extend; keep existing column order,
  append new columns.)

## Testing

- **API (vitest):**
  - `normalizeStructured` maps `hsnSac` + the five new fields from model JSON.
  - `PATCH` persists the new invoice fields and per-line `hsnSac`.
  - CSV export includes the new columns.
- **Web:** `tsc --noEmit` clean; browser smoke — re-extract the example invoice
  with a markdown provider and confirm the breakdown rows + HSN/SAC render, and
  that the ledger TOTAL still shows the Net Bill.

## Out of scope

- Per-HSN tax grouping / GST summary tables.
- Multi-rate tax tables beyond the single CGST/SGST/IGST trio.
- Back-filling existing invoices from raw OCR (re-extraction is the path).
