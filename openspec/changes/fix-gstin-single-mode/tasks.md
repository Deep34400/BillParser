## Tasks

### Task 1: Add failing test — single-mode GSTIN correction

- **What:** Write a test that simulates single-mode pipeline returning buyer GSTIN, verifying that after enrichment with OCR markdown, the seller GSTIN is selected. Currently this test will fail because single mode doesn't pass markdown.
- **Where:** `platform/tests/ocr/extraction/vendorExtract.test.ts` (or new file `platform/tests/ocr/pipeline/gstinSingleMode.test.ts`)
- **Tests:** Test asserts `enriched.gstin === sellerGstin` when enrichment receives markdown containing both buyer and seller GSTINs with clear section labels.
- **Acceptance:** Test fails before implementation, passes after.

### Task 2: Add `ocrMarkdown` to `PipelineResult`

- **What:** Add optional `ocrMarkdown?: string` field to the `PipelineResult` interface. This holds real OCR markdown (when available) separately from `rawOcr` which may be LLM JSON.
- **Where:** `platform/src/ocr/process.ts` (where `PipelineResult` is defined)
- **Tests:** TypeScript compiles. No runtime change yet.
- **Acceptance:** Field exists on the interface. No existing code breaks.

### Task 3: Surface `ocrMarkdown` from split mode

- **What:** In `runSplitMode`, set `ocrMarkdown = rawOcr` since split mode's `rawOcr` IS the OCR markdown.
- **Where:** `platform/src/ocr/pipeline/split.ts`
- **Tests:** Existing split-mode tests pass unchanged.
- **Acceptance:** `PipelineResult.ocrMarkdown` is populated in split mode.

### Task 4: Surface `ocrMarkdown` from Mistral single-mode (PDF path)

- **What:** In `runSingleMode`, for the Mistral PDF path that already calls `mistralOcr()` and has `ocr.markdown`, set `ocrMarkdown = ocr.markdown` on the returned result.
- **Where:** `platform/src/ocr/providers/llmSingle.ts` (~lines 206–233)
- **Tests:** Existing tests pass. Mistral PDF single mode now returns `ocrMarkdown`.
- **Acceptance:** `ocrMarkdown` is set for Mistral PDF; other providers return `ocrMarkdown: undefined`.

### Task 5: Use `ocrMarkdown` in fallback chain enrichment

- **What:** In `fallbackChain.ts` line 156, change `enrichParsedInvoice(result.parsed, result.rawOcr)` to `enrichParsedInvoice(result.parsed, result.ocrMarkdown ?? result.rawOcr)`.
- **Where:** `platform/src/ocr/pipeline/fallbackChain.ts` line 156
- **Tests:** Failing test from Task 1 now passes. All existing tests pass.
- **Acceptance:** When `ocrMarkdown` is available, it is used for enrichment (including vendor correction). When not available, falls back to `rawOcr` (existing behavior).

### Task 6: Run full test suite and verify

- **What:** Run all vendor extraction tests, all OCR tests, full platform test suite, typecheck.
- **Where:** Terminal
- **Tests:** `npx vitest run tests/ocr/extraction/vendorExtract.test.ts`, `npx vitest run`, `npx tsc --noEmit`
- **Acceptance:** All tests pass. No regressions. Typecheck clean.
- **Verification:** `git diff --stat` shows only scoped files changed. No `vendor.ts`, `prompt.ts`, or `ParsedInvoiceData` modifications.
