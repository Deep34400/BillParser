# OCR Module

Extracts structured invoice data from uploaded PDF/image files using LLM-based OCR.
This is the core module — everything else (analytics, fraud, billing) depends on its output.

## How It Works — Full Flow

### 1. User Uploads a File

The user sends a PDF or image to `POST /api/invoices/upload`. The route handler in `route.ts`:

1. Validates the file (must be PDF, JPEG, PNG, or WebP)
2. Generates a unique `billId` (UUID)
3. Uploads the file to Google Cloud Storage (or stores in-memory in LOCAL_DEV)
4. Creates a placeholder `BillDoc` in Firestore with `ocr_status: 'UPLOADED'`
5. Reads the current pipeline settings (single vs split mode, which model)
6. Stamps the bill with the chosen pipeline settings (so the UI can show which model was used)
7. Returns `HTTP 202` immediately — OCR runs in the background

### 2. Background Processing Begins

`processingService.ts` takes over in the background:

1. Updates the bill's status to `PROCESSING`
2. Downloads the file from storage into a Buffer
3. Calls `structuringService.runOcrPipeline()` with the file buffer and settings
4. If the pipeline succeeds:
   - Maps the parsed data to a `BillDoc` using `mapper.ts → mapParsedToBill()`
   - Extracts individual parts/labour items into `BillPartDoc` records
   - Saves everything to Firestore
   - Updates status to `OCR_COMPLETED`
   - Invalidates the analytics cache (so dashboards refresh)
5. If it fails: marks the bill as `FAILED` with an error message

### 3. OCR Pipeline — Single vs Split Mode

`structuringService.ts` orchestrates the actual OCR. There are two modes:

**Single Mode** (default, recommended):
```
File buffer (PDF/image)
  → providers/llmSingle.ts
    → Sends the image + STRUCTURING_PROMPT to one LLM in a single API call
    → The LLM sees the image and returns structured JSON directly
    → Supports: Gemini (via Vertex AI), Claude, OpenAI, Mistral
  → Returns: { parsedData, costInfo }
```

**Split Mode** (two-step):
```
File buffer
  → Step 1: providers/mistralOcr.ts
    → Sends file to Mistral's OCR API
    → Returns: markdown text (the raw text content of the invoice)
  → Step 2: providers/llmNormalize.ts
    → Sends markdown + STRUCTURING_PROMPT to a second LLM
    → The LLM reads the markdown and returns structured JSON
  → Returns: { parsedData, costInfo }
```

**Fallback**: If the primary model fails (any mode), the system retries with `gemini-2.5-flash` in single mode. Single mode never falls back to split. This keeps things predictable.

### 4. JSON Parsing — LLM Text to Structured Data

The LLM returns raw text that (should be) JSON. `parsing/parse.ts` handles the messiness:

1. **`repairTruncatedJson()`** in `coerce.ts` — fixes missing closing braces, trailing commas, and other issues from truncated LLM responses
2. **`pickParsedDataBlob()`** — unwraps various JSON wrapper shapes the LLM might return:
   - `{"output":{"entries":[{"parsed_data":{...}}]}}` (standard schema)
   - `{"output":[{"parsed_data":{...}}]}` (Gemini variant)
   - `{"parsed_data":{...}}` (direct)
   - Raw `{...}` (no wrapper at all)
3. **`coerceParsedInvoiceData()`** — type-safe field extraction with `toNum()`, `toStr()` helpers. Handles LLM returning strings where numbers are expected, null vs undefined, etc.
4. **`validateParsedInvoice()`** — checks for impossible values (negative amounts, dates in wrong format)
5. **`structureFromLlmResponse()`** — the main entry point that wraps all the above with error handling

### 5. Post-Parse Enrichment

After parsing, `extraction/normalize.ts → enrichParsedInvoice()` fixes common OCR issues:

1. **Vendor name cleanup** (`vendorExtract.ts`) — strips table noise, detects junk names like raw JSON blobs or "Invoice"
2. **Date normalization** (`dateExtract.ts`) — standardizes date formats, extracts from markdown when LLM misses it
3. **Vehicle registration** (in `normalize.ts`) — normalizes Indian plate formats (MH01FE2778), falls back to regex extraction from markdown
4. **Labour line item filtering** (in `normalize.ts`) — removes table section headers the LLM includes as line items
5. **GST calculation** (`billSummary.ts`) — reconciles subtotals, fills missing GST amounts from rates
6. **Review flags** (`reviewFlags.ts`) — marks invoices for human review when data seems incomplete or inconsistent

### 6. Data Mapping

`mapper.ts` has three transformation functions:

- **`mapParsedToBill()`** — Converts `ParsedInvoiceData` → `BillDoc` for Firestore storage. Adds cost tracking fields, pipeline metadata, and review reasons.
- **`billToInvoice()`** — Converts `BillDoc` → `FrontendInvoice` for the API response. Maps Firestore field names to the frontend's expected shape.
- **`toApiParsed()`** — Normalizes `ParsedInvoiceData` into a stable, clean shape for the `/api/parse` endpoint. This is the IMMUTABLE OCR contract — do not change field names.

## File Reference

| File | What it does |
|------|-------------|
| `route.ts` | HTTP endpoints — upload, list, get, delete, re-extract, sync parse |
| `processingService.ts` | Background OCR orchestrator — download file → run pipeline → save results |
| `structuringService.ts` | Pipeline runner — single/split mode selection, fallback logic |
| `mapper.ts` | Data transformations — ParsedData↔BillDoc↔FrontendInvoice↔ApiResponse |
| `providers/geminiClient.ts` | Gemini via Vertex AI — ADC auth, global endpoint, thinking config |
| `providers/llmSingle.ts` | Single-call mode — image + prompt → structured JSON |
| `providers/llmNormalize.ts` | Split-mode structuring — markdown + prompt → structured JSON |
| `providers/mistralOcr.ts` | Mistral OCR API — PDF/image → markdown text |
| `providers/resolveKey.ts` | API key + model resolution from settings or env vars |
| `providers/types.ts` | LlmUsage, OcrStepCost, OcrCostInfo type definitions |
| `parsing/parse.ts` | Main parser — LLM text → ParsedInvoiceData + structureFromLlmResponse |
| `parsing/coerce.ts` | Type coercion helpers — toNum, toStr, JSON repair |
| `parsing/validate.ts` | Field-level validation — dates, amounts, GST consistency |
| `parsing/prompt.ts` | STRUCTURING_PROMPT — the instructions sent to the LLM |
| `parsing/legacy.ts` | Backward-compat parser for old canonical JSON format |
| `parsing/types.ts` | Parsing-specific types — ParseResult, ValidationIssue |
| `extraction/normalize.ts` | Master enrichment — vendor, dates, vehicle, GST, line items |
| `extraction/vendorExtract.ts` | Company name cleanup + junk name detection |
| `extraction/dateExtract.ts` | Invoice date normalization + markdown fallback |
| `extraction/footerExtract.ts` | Footer/summary extraction from OCR markdown |
| `extraction/billSummary.ts` | GST calculation, subtotal/total reconciliation |
| `extraction/reviewFlags.ts` | Human-review flags (missing GSTIN, mismatched totals) |

## How to Change the OCR Model

1. Go to Settings UI → change the model under Single or Split mode
2. The setting is saved to Firestore (or devStore in LOCAL_DEV)
3. Next upload reads the setting and uses that model
4. The bill gets stamped with which model was used (visible in invoice detail)

## How to Add a New LLM Provider

1. Add the provider config in `providers/resolveKey.ts` (API key env var, default model)
2. Add the API call logic in `providers/llmSingle.ts` (for single mode) or `providers/llmNormalize.ts` (for split mode)
3. The rest of the pipeline (parsing, enrichment, mapping) is provider-agnostic

## Testing

Tests are in `tests/ocr/` and mirror this folder structure. Run with `npm test`.

Critical suites:
- `structureAccuracy.test.ts` — end-to-end parsing with real invoice shapes
- `normalize.test.ts` — field enrichment correctness
- `billMapper.test.ts` — Firestore mapping
- `billToInvoice.test.ts` — frontend API response shape
