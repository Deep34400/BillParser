# OCR Module

Extracts structured invoice data from uploaded PDF/image files using LLM-based OCR.
This is the core module — everything else (analytics, fraud, vendor) depends on its output.

## Folder Structure

```
ocr/
├── process.ts                    # Pipeline entry point — reads settings, routes to single/split
├── pipeline/
│   ├── single.ts                 # Single OCR mode orchestration + fallback
│   └── split.ts                  # Split OCR mode orchestration + fallback
├── providers/
│   ├── geminiClient.ts           # Gemini via Vertex AI — ADC auth, global endpoint
│   ├── llmSingle.ts              # Single-call: image + prompt → structured JSON
│   ├── llmNormalize.ts           # Split structuring: markdown + prompt → JSON
│   ├── mistralOcr.ts             # Mistral OCR API: PDF/image → markdown
│   └── resolveKey.ts             # API key + model resolution from settings/env
├── parser/
│   ├── prompt.ts                 # STRUCTURING_PROMPT — instructions for the LLM
│   ├── parser.ts                 # Raw LLM text → ParsedInvoiceData (coerce + unwrap + legacy)
│   └── repair.ts                 # JSON repair: truncated braces, trailing commas, etc.
├── transformer/
│   ├── normalize/
│   │   ├── index.ts              # enrichParsedInvoice() — master enrichment entry point
│   │   ├── vendor.ts             # Seller vs buyer detection, junk name filtering
│   │   ├── vehicle.ts            # Registration number normalization + markdown fallback
│   │   ├── date.ts               # Invoice date normalization + markdown fallback
│   │   ├── footer.ts             # OCR markdown footer parser (GST, discount, totals)
│   │   └── totals.ts             # Bill summary reconciliation pipeline
│   ├── validate.ts               # Structural validation rules (amounts, formats)
│   └── review.ts                 # Human-review flag generation
├── mapper.ts                     # Data transformations: ParsedData ↔ BillDoc ↔ FrontendInvoice
├── repository.ts                 # Firestore CRUD for bills and bill_parts
├── types/
│   ├── invoice.ts                # Re-exports ParsedInvoiceData, BillDoc, etc. from shared
│   ├── parser.ts                 # ValidationIssue, ParseResult
│   ├── provider.ts               # LlmUsage, OcrStepCost, OcrCostInfo
│   └── index.ts                  # Barrel export
├── route.ts                      # HTTP endpoints (controller layer)
└── README.md
```

## How It Works — Full Flow

### 1. Upload

`POST /api/invoices/upload` → `route.ts`:
1. Validates the file (PDF, JPEG, PNG, or WebP)
2. Uploads to Cloud Storage
3. Creates a placeholder `BillDoc` with `ocr_status: 'PROCESSING'`
4. Returns `HTTP 202` immediately — OCR runs in the background

### 2. Pipeline Orchestration

`process.ts → runPipeline()` reads DB settings and routes to the chosen mode:

**Single Mode** (default):
```
Buffer → pipeline/single.ts → providers/llmSingle.ts
  → One multimodal LLM call (image + prompt → JSON)
  → Supports: Gemini, Claude, OpenAI, Mistral
```

**Split Mode**:
```
Buffer → pipeline/split.ts
  → Step 1: providers/mistralOcr.ts (image → markdown)
  → Step 2: providers/llmNormalize.ts (markdown + prompt → JSON)
```

**Fallback**: If the primary model fails, retries with `gemini-2.5-flash` in single mode. Single never falls back to split.

### 3. JSON Parsing

`parser/parser.ts → structureFromLlmResponse()`:
1. `repair.ts` fixes truncated braces, trailing commas, Indian number formatting
2. `pickParsedDataBlob()` unwraps various JSON wrapper shapes the LLM returns
3. `coerceParsedInvoiceData()` converts loose types to strict `ParsedInvoiceData`
4. Falls back to legacy canonical format (`vendorName`, `lineItems`) if detected

### 4. Post-Parse Enrichment

`transformer/normalize/index.ts → enrichParsedInvoice()`:
1. **Vendor resolution** (`vendor.ts`) — seller vs buyer GSTIN/name correction
2. **Date normalization** (`date.ts`) — format standardization + markdown fallback
3. **Vehicle details** (`vehicle.ts`) — registration number cleanup
4. **Company name cleanup** — strips table noise, junk names, LLM schema leakage
5. **Invoice number fallback** — Job Card No, Bill No from markdown
6. **PAN from GSTIN** — derives PAN from GSTIN middle 10 chars
7. **Labour filtering** — removes section headers mistakenly extracted as line items
8. **Bill summary** (`totals.ts` + `footer.ts`) — reconciles subtotals, GST, discounts

### 5. Validation & Review

- `transformer/validate.ts` — structural checks (GST range, amount consistency)
- `transformer/review.ts` — advisory flags for the UI (missing GSTIN, totals mismatch)

### 6. Mapping & Storage

- `mapper.ts → mapParsedToBill()` — converts to `BillDoc` for Firestore
- `mapper.ts → toApiParsed()` — stable API response contract (IMMUTABLE)
- `mapper.ts → billToInvoice()` — frontend-ready shape
- `repository.ts` — Firestore CRUD for bills and bill_parts

## How to Change the OCR Model

1. Settings UI → change model under Single or Split mode
2. Saved to Firestore (or devStore in LOCAL_DEV)
3. Next upload reads the setting and uses that model
4. Bill is stamped with which model was used

## How to Add a New LLM Provider

1. Add provider config in `providers/resolveKey.ts`
2. Add API call in `providers/llmSingle.ts` (single) or `providers/llmNormalize.ts` (split)
3. The rest of the pipeline (parsing, enrichment, mapping) is provider-agnostic

## Testing

Tests are in `tests/ocr/` — run with `npm test`.

Critical suites:
- `structureAccuracy.test.ts` — end-to-end parsing with real invoice shapes
- `normalize.test.ts` — field enrichment correctness
- `vendorExtract.test.ts` — seller vs buyer detection
- `footerExtract.test.ts` — GST footer parsing
- `billMapper.test.ts` — Firestore mapping
