# Columnwise invoice summary (Parts / Labour …)

**Date:** 2026-06-24
**Status:** Approved

## Goal

Job-card invoices split their totals summary into value columns (e.g. Parts and
Labour), each with its own Sub Total / Less Discount / GST / Sub Total-incl-tax,
and a single overall Net Bill Amount. Capture and display that columnwise
breakdown, keeping the existing scalar fields as the overall (cross-column)
totals.

Example (`cmqlseoz4000iww7tvbrb4ifv`):

```
                Parts        Labour
Sub Total      70,766.70    30,450.00
Less Discount   7,076.72    10,950.00
IGST @18%      11,464.19     3,510.00
Sub Total      75,154.17    23,010.00      (= subtotal - discount + tax)
Net Bill Amount         98,164.00          (overall = 75,154.17 + 23,010.00, rounded)
```

## Field model

Add one nullable JSON field; keep all existing scalar fields as the overall totals.

- `Invoice.summaryColumns Json?` — array of:
  `{ label: string, subtotal?: number, discount?: number, cgst?: number,
     sgst?: number, igst?: number, total?: number }`
- Existing scalars remain the **overall** figures: `subtotal/discountAmount/
  cgstAmount/sgstAmount/igstAmount/taxAmount/totalAmount` = sums across columns;
  `netAmount` = overall payable. These continue to drive ledger, analytics, CSV.

Single-column invoices leave `summaryColumns` null and render as today.

## Data model (Prisma)

- `Invoice.summaryColumns Json?`. One additive migration.

## Extraction

- `providers/types.ts`: add `SummaryColumn` interface and
  `CanonicalResult.summaryColumns?: SummaryColumn[]`.
- `STRUCTURING_PROMPT`: when the summary is split into columns (Parts, Labour,
  Accessories …), emit one `summaryColumns` entry per column with its label and
  amounts; still emit the overall scalar fields as the cross-column totals plus
  `netAmount`. If the invoice has a single summary column, omit `summaryColumns`.
- `normalizeStructured`:
  - Coerce `summaryColumns` (label via `toStr`, amounts via `toNum`); drop
    entries that are entirely empty.
  - Apply the existing forgotten-discount correction to each column's `total`
    (`subtotal - discount + tax`) and to the overall `totalAmount`/`netAmount`,
    via a shared helper.

## Persistence

- `extraction/run.ts` `headerData`: include `summaryColumns` (writes to the
  Invoice and the run snapshot).
- `PATCH /api/invoices/:id`: `summaryColumns` flows through `...fields`
  automatically (Prisma `Json` column accepts the array). No special handling
  beyond ensuring the value is passed (it is).
- apply-run: `...fields` from the snapshot carries `summaryColumns`.

## UI

### Display — `InvoiceDetailPage` + `CompareOverlay`

- New `web/src/components/SummaryColumns.tsx`:
  - Renders a compact table when `inv.summaryColumns` has ≥1 entry: first column
    is the row label, then one right-aligned value column per summary column
    (header = `label`).
  - Rows, each shown only if any column has a value: Sub Total (`subtotal`),
    Less Discounts (`discount`), CGST (`cgst`), SGST (`sgst`) **or** IGST
    (`igst`), Sub Total (`total`).
  - A final full-width, bold **Net Bill Amount** row = `inv.netAmount ??
    inv.totalAmount`, right-aligned across the value columns.
- `SummaryBreakdown` stays for the fallback. The detail footer and CompareOverlay
  render `SummaryColumns` when `summaryColumns?.length`, else `SummaryBreakdown`.

### Edit — `InvoiceDetailPage`

- New "Summary columns" panel (read into editable state on `enterEdit`):
  - Each column row: editable label + numeric inputs for subtotal, discount,
    cgst, sgst, igst, total; a remove (×) button.
  - An "+ Add column" button appends a blank column.
  - `saveEdit` serializes non-empty columns into the PATCH body as
    `summaryColumns` (numbers via `parseNum`, dropping all-empty columns → send
    `null` when none remain).
- The existing overall scalar inputs remain (authoritative for ledger/CSV).

## CSV

No change — export keeps the overall scalar columns. Per-column flattening is out
of scope.

## Testing

- **API (vitest):**
  - `normalizeStructured` parses `summaryColumns`, coerces strings→numbers, and
    applies the per-column discount correction (e.g. a column whose `total`
    equals `subtotal + tax` is corrected to `subtotal - discount + tax`).
  - `PATCH` persists `summaryColumns` and reading the invoice returns it.
- **Web:** `tsc --noEmit` clean; browser smoke — re-extract the example invoice,
  confirm the Parts/Labour columns render with Net Bill ₹98,164 overall, and
  round-trip an edit (add/modify a column, save, reload).

## Out of scope

- Per-column CSV export columns.
- Analytics by column.
- Validation that columns sum to the overall scalars (display trusts extraction;
  user can correct via Edit).
