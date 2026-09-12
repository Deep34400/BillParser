## Context

`resolveVendorFromMarkdown()` in `vendor.ts` correctly detects seller vs buyer GSTINs by scanning OCR markdown for section labels ("Cust GSTIN", "Dealer GSTIN", "Bill To", etc.) and positional/keyword heuristics. This works in **split mode** because `rawOcr` = Mistral OCR markdown.

In **single mode**, `rawOcr` = LLM JSON response. `isLlmJsonBlob()` returns true and correction is skipped. The LLM's (often wrong) GSTIN sticks.

## Goals

1. Ensure `resolveVendorFromMarkdown` receives real OCR markdown in single-mode pipelines.
2. No changes to `vendor.ts` correction logic itself.
3. No changes to `ParsedInvoiceData` contract.
4. No changes to split-mode flow.
5. No changes to prompt or LLM structuring.

## Non-Goals

- Improving the vendor detection heuristics (labels, keywords, position) — separate change if needed.
- Adding a `customer_gstin` field — out of scope.
- Changing `BUYER_GSTIN_BLOCKLIST` — separate concern.

## Decision: Pass OCR markdown separately from rawOcr

### Option A: Run a lightweight Mistral OCR before single-mode LLM call (rejected)
- Adds latency and cost for every single-mode call.
- Overkill — we only need markdown for vendor correction.

### Option B: Add an `ocrMarkdown` field to `PipelineResult` (chosen)
- `PipelineResult` already has `rawOcr: string`. Add an optional `ocrMarkdown?: string` field.
- Split mode: `ocrMarkdown = rawOcr` (already OCR markdown).
- Single mode (Mistral PDF): already runs OCR → `ocrMarkdown = ocr.markdown`.
- Single mode (vision — Gemini/Claude/OpenAI): `ocrMarkdown` stays undefined. **No extra OCR call.**
- `enrichParsedInvoice` already accepts an optional `markdown` parameter. `fallbackChain.ts` passes `result.ocrMarkdown ?? result.rawOcr`.

### Option C: Always run Mistral OCR for markdown in vision-single mode (future improvement)
- Could be added later if vendor correction is still needed for vision-single.
- Out of scope for this change — focus on modes that already HAVE markdown.

**Key insight:** Mistral single-mode on PDF (`llmSingle.ts` ~line 206–233) already runs `mistralOcr()` and has `ocr.markdown`. It just doesn't return it separately. We surface that.

## Approach

1. Add `ocrMarkdown?: string` to `PipelineResult` interface.
2. In `runSingleMode`: for Mistral PDF path, set `ocrMarkdown = ocr.markdown`.
3. In `runSplitMode`: set `ocrMarkdown = rawOcr` (already markdown).
4. In `fallbackChain.ts` line 156: `enrichParsedInvoice(result.parsed, result.ocrMarkdown ?? result.rawOcr)`.
5. For AzAPI: if it returns markdown, surface it; otherwise `ocrMarkdown` stays undefined.

## Risks

| Risk | Mitigation |
|---|---|
| Vendor correction changes a previously-correct GSTIN | `shouldFix` guards are conservative; existing tests cover this |
| Performance | No extra API calls — only surfacing already-available markdown |
| Vision-single still has no markdown | Accepted limitation; LLM prompt already says "seller's GSTIN" |

## What does NOT change

- `vendor.ts` — zero modifications
- `prompt.ts` — zero modifications
- `ParsedInvoiceData` — no new fields
- Split mode — behavior identical
- Reconciliation — not affected
- GST calculation — not affected
- Stored data shape — not affected
