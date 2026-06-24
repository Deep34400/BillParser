# GST enrichment for structured providers + always-on summary rows

**Date:** 2026-06-24
**Status:** Approved

## Problem

Invoices extracted by a structured provider (Azure Document Intelligence,
Textract) miss the GST breakdown entirely: Azure's mapper only fills
subtotal/tax/total — never the CGST/SGST/IGST split, discount, summary columns,
or per-line HSN/labour. So the bottom summary shows no GST section.

Separately, the summary should always present the standard rows — a "Less
Discounts" line (even when zero) and a GST section (CGST+SGST or IGST).

## Part 1 — Structuring enrichment for structured providers

After a structured provider returns its result, run the configured structuring
model over the OCR `rawText` and merge the two, so the structured provider's
strong header detection combines with structuring's GST understanding.

### Where

`extraction/run.ts` `runExtractionWith`, immediately after
`provider.extract(...)`:

```
let result = await provider.extract(file, creds, ctx);
if (provider.kind === 'structured' && result.rawText) {
  result = await enrichStructured(result);   // structuring/index.ts
}
```

`runOneForBakeoff` is left unchanged (bake-off compares raw provider output).

### `enrichStructured(base) : Promise<CanonicalResult>`

In `structuring/index.ts`:

1. `getStructuringModel()` — if it throws (none configured), return `base`.
2. `const s = await model.structure(base.rawText, creds)` — the structuring pass
   (already applies GST-regime reconciliation and discount correction).
3. Merge (see policy) and return; on ANY error, return `base` unchanged so
   extraction never breaks.

### Merge policy

- **Identity fields** — `base` (structured provider) wins when non-null, else
  `s`: vendorName, vendorAddress, vendorTaxId, invoiceNumber, poNumber,
  invoiceDate, dueDate, currency, paymentTerms.
- **GST summary** — `s` (structuring) wins, falling back to `base`: subtotal,
  discountAmount, taxAmount, totalAmount, netAmount. cgstAmount/sgstAmount/
  igstAmount and summaryColumns come from `s` (base has none).
- **lineItems** — `s.lineItems` when it has any (they carry hsnSac/labourAmount),
  else `base.lineItems`.
- **Preserved from base**: rawText, rawJson, costEstimate, confidence
  (`base.confidence ?? s.confidence`). `structuringCost` set from `s`.

## Part 2 — Always-on summary rows

Both summary renderers always show the standard rows so structure is consistent.

### `SummaryBreakdown` (single-column)

Render only when the invoice has any summary figure (`subtotal`, `totalAmount`,
or `netAmount` present). Then:

- Sub Total — `subtotal` (when present).
- **Less Discounts** — always; `discountAmount ?? 0`.
- GST section — **IGST** row (`igstAmount`) when `igstAmount != null`; otherwise
  **CGST** (`cgstAmount ?? 0`) and **SGST** (`sgstAmount ?? 0`) rows.
- Sub Total — `totalAmount` (when present).
- **Net Bill Amount** — `netAmount ?? totalAmount`, bold.

Forced rows (Less Discounts, CGST/SGST/IGST) display `0.00` when the value is
absent rather than being omitted.

### `SummaryColumns` (columnwise)

- Regime: `hasIgst = cols.some(c => c.igst != null)`.
- Rows: Sub Total (`subtotal`, shown if any column has it), **Less Discounts**
  (always), then **IGST** (if `hasIgst`) else **CGST** + **SGST** (always), then
  Sub Total (`total`, shown if any column has it).
- Net Bill Amount row unchanged (overall).
- Cell rendering: forced rows (discount, GST) show `money(value ?? 0)`;
  non-forced rows (subtotal, total) show `—` when absent.

## Testing

- **API (vitest):** `enrichStructured` merges per policy — identity from base,
  GST from structuring, lineItems from structuring when present; returns base
  unchanged when structuring is unavailable (mock `getStructuringModel`).
- **Web:** `tsc --noEmit` clean; browser smoke — re-extract the example invoice
  and confirm CGST ₹117.84 + SGST ₹117.84 render with Less Discounts ₹0.00.

## Out of scope

- CSV per-column flattening; analytics by column.
- Enriching markdown-provider results (they already structure internally).
