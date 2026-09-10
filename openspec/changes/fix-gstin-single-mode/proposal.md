## Why

When invoices are processed in **single mode** (Gemini, Claude, OpenAI, AzAPI), the seller/buyer GSTIN correction logic in `resolveVendorFromMarkdown()` is **skipped** because `rawOcr` contains the LLM's JSON response, not OCR markdown text. The function detects this as JSON (`isLlmJsonBlob`) and returns early without correcting the GSTIN.

Indian workshop invoices commonly show the **fleet operator / buyer GSTIN** prominently at the top (e.g. "Cust GSTIN/UIN: 27AALCC…") while the **dealer / seller GSTIN** is at the bottom in small print. The LLM frequently picks the buyer's GSTIN despite prompt instructions to use the seller's. In split mode this is corrected by `resolveVendorFromMarkdown`; in single mode the wrong value sticks.

**Current behavior:** Single-mode pipelines return the LLM's `gstin` as-is — often the buyer's GSTIN.
**Desired behavior:** Single-mode pipelines also apply seller/buyer GSTIN correction when OCR markdown is available or obtainable.

## What Changes

Pass usable OCR markdown to `enrichParsedInvoice` for single-mode pipelines so that `resolveVendorFromMarkdown` can correct buyer→seller GSTIN misassignment. The existing vendor correction logic, buyer section labels, keyword classification, and positional heuristics remain unchanged.

No new fields added to `ParsedInvoiceData`. No changes to the prompt, split mode, reconciliation, GST calculation, or stored data shape.

## Capabilities

### Modified Capabilities

- `gstin-vendor-correction`: Extend vendor GSTIN correction to work in single-mode OCR pipelines (Gemini, Claude, OpenAI, AzAPI) by ensuring real OCR markdown reaches `resolveVendorFromMarkdown`.

## Impact

- **Files modified:** `platform/src/ocr/pipeline/fallbackChain.ts` (pass markdown), possibly `platform/src/ocr/providers/llmSingle.ts` or `platform/src/ocr/pipeline/single.ts` (return OCR markdown separately from rawOcr).
- **Existing flows:** Split mode is unaffected. Single-mode extraction logic is unaffected. Vendor correction code (`vendor.ts`) is not modified — only called with correct input.
- **Risk:** Low. The correction logic already exists and is tested. We only ensure it receives markdown input in single mode.
- **Non-regression:** All existing vendor extraction tests must pass. Split mode behavior unchanged.
