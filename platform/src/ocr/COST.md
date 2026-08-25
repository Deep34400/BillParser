# OCR Cost Analysis — Complete Guide

How every OCR call's cost is calculated, stored, and displayed in the frontend.

---

## 1. Where Default Pricing Lives

**File:** `shared/modelPricing.ts`

Prices are always in **USD per 1 million tokens** (`inputPer1M` / `outputPer1M`).

Example (matches your Settings screenshot for Gemini):

| Model | Input $/1M | Output $/1M |
|-------|-----------|------------|
| gemini-2.5-flash | **0.30** | **2.50** |
| gemini-2.5-pro | 1.25 | 10.00 |
| gemini-3.5-flash | 1.50 | 9.00 |

Source: [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) (Aug 2026).

### How Frontend Settings ↔ Code works

```
1. GET /api/settings
   → merges DEFAULT_MODEL_PRICING + AppSettings.modelPricing (UI overrides)
   → Settings page shows $/1M in the table

2. User edits Input/Output → clicks Save Pricing
   → PUT /api/settings { modelPricing: { only changed models } }
   → saved in Firestore AppSettings.modelPricing

3. Next OCR run
   → getSettings() → resolveModelPricing(model, overrides)
   → if UI override exists → use it
   → else → use DEFAULT_MODEL_PRICING from code
   → cost = (tokens / 1_000_000) × $/1M
```

**Display in UI is INR** (`USD × 83` via `costFmt`), but **pricing rates are always USD**.


---

## 2. How Token Counts Are Captured

Every LLM API returns token usage in its response:

```
┌─────────────────────────────────────────────────────────┐
│ Provider API Response                                   │
│                                                         │
│  Gemini:   usageMetadata.promptTokenCount               │
│            usageMetadata.candidatesTokenCount            │
│            usageMetadata.totalTokenCount                 │
│                                                         │
│  Claude:   usage.input_tokens                           │
│            usage.output_tokens                          │
│                                                         │
│  OpenAI:   usage.prompt_tokens                          │
│            usage.completion_tokens                      │
│            usage.total_tokens                           │
│                                                         │
│  Mistral:  usage.prompt_tokens                          │
│  (chat)    usage.completion_tokens                      │
│            usage.total_tokens                           │
│                                                         │
│  Mistral:  usage_info.pages_processed                   │
│  (OCR)     → synthetic: pages × 1000 = prompt_tokens    │
└─────────────────────────────────────────────────────────┘
```

These are parsed into a standard `LlmUsage` shape:

```typescript
// types/provider.ts
interface LlmUsage {
  prompt_tokens: number;      // input tokens
  completion_tokens: number;  // output tokens
  total_tokens: number;       // sum
}
```

---

## 3. How Cost Is Calculated (Step by Step)

### Step 3a: Provider estimates cost

Each provider file has an `estimateCost()` function that computes:

```
input_cost_usd  = (prompt_tokens / 1,000,000) × inputPer1M
output_cost_usd = (completion_tokens / 1,000,000) × outputPer1M
cost_usd        = input_cost_usd + output_cost_usd
```

**Files that do this:**
- `providers/geminiClient.ts` → `estimateGeminiCostUsd(usage, model)`
- `providers/llmSingle.ts` → `estimateCost(usage, pricing)` (Claude, OpenAI, Mistral vision)
- `providers/llmNormalize.ts` → `estimateCost(usage, pricing)` (structuring step)
- `providers/mistralOcr.ts` → page-based: `pages × $0.002` (all goes to input_cost)

### Step 3b: Wrapped into OcrStepCost

```typescript
// types/provider.ts
interface OcrStepCost {
  provider: string;         // 'gemini', 'claude', 'openai', 'mistral'
  model: string;            // 'gemini-2.5-flash', etc.
  usage: LlmUsage;          // raw token counts
  cost_usd: number;         // total cost in USD
  input_cost_usd: number;   // input-only cost
  output_cost_usd: number;  // output-only cost
  latency_ms: number;       // API call duration
}
```

### Step 3c: Pipeline combines steps into OcrCostInfo

**Single mode** (1 API call):
```
OcrCostInfo = {
  extraction: stepCost,         // the single call
  structuring: null,
  total_cost_usd: stepCost.cost_usd,
  total_tokens: usage.total_tokens,
  total_input_tokens: usage.prompt_tokens,
  total_output_tokens: usage.completion_tokens,
  total_input_cost_usd: stepCost.input_cost_usd,
  total_output_cost_usd: stepCost.output_cost_usd,
}
```

**Split mode** (2 API calls):
```
OcrCostInfo = {
  extraction: mistralOcrCost,    // Mistral OCR step
  structuring: llmNormalizeCost, // LLM structuring step
  total_cost_usd:        extraction.cost_usd + structuring.cost_usd,
  total_tokens:          extraction.total_tokens + structuring.total_tokens,
  total_input_tokens:    extraction.prompt_tokens + structuring.prompt_tokens,
  total_output_tokens:   extraction.completion_tokens + structuring.completion_tokens,
  total_input_cost_usd:  extraction.input_cost_usd + structuring.input_cost_usd,
  total_output_cost_usd: extraction.output_cost_usd + structuring.output_cost_usd,
}
```

---

## 4. How Cost Is Stored in Firestore

`mapper.ts → mapParsedToBill()` persists these fields on every `BillDoc`:

| Firestore Field | Source | Example |
|----------------|--------|---------|
| `pipeline_mode` | `'single'` or `'split'` | `'single'` |
| `extraction_cost_usd` | extraction step cost | `0.00024` |
| `structuring_cost_usd` | structuring step cost (null if single) | `null` |
| `total_cost_usd` | sum of all steps | `0.00024` |
| `extraction_tokens` | extraction total tokens | `4563` |
| `extraction_input_tokens` | extraction prompt tokens | `4200` |
| `extraction_output_tokens` | extraction completion tokens | `363` |
| `structuring_tokens` | structuring total tokens (null if single) | `null` |
| `structuring_input_tokens` | structuring prompt tokens | `null` |
| `structuring_output_tokens` | structuring completion tokens | `null` |
| `total_tokens` | sum of all tokens | `4563` |
| `total_input_tokens` | sum of all prompt tokens | `4200` |
| `total_output_tokens` | sum of all completion tokens | `363` |
| `total_input_cost_usd` | sum of input costs | `0.00013` |
| `total_output_cost_usd` | sum of output costs | `0.00091` |
| `extraction_model` | model used | `'gemini-2.5-flash'` |
| `structuring_model` | model used (null if single) | `null` |
| `extraction_provider` | provider | `'gemini'` |
| `structuring_provider` | provider (null if single) | `null` |
| `extraction_latency_ms` | API call time | `12900` |
| `total_latency_ms` | total time | `12900` |

---

## 5. How Frontend Receives Cost Data

### 5a: API Response

`mapper.ts → billToInvoice()` maps Firestore fields to camelCase for the frontend:

```
BillDoc (snake_case)              →  FrontendInvoice (camelCase)
─────────────────────                ──────────────────────────
total_cost_usd                    →  costEstimate
extraction_cost_usd               →  extractionCost
structuring_cost_usd              →  structuringCost
extraction_tokens                 →  extractionTokens
extraction_input_tokens           →  extractionInputTokens
extraction_output_tokens          →  extractionOutputTokens
structuring_tokens                →  structuringTokens
structuring_input_tokens          →  structuringInputTokens
structuring_output_tokens         →  structuringOutputTokens
total_tokens                      →  totalTokens
total_input_tokens                →  totalInputTokens
total_output_tokens               →  totalOutputTokens
total_input_cost_usd              →  totalInputCostUsd
total_output_cost_usd             →  totalOutputCostUsd
extraction_model                  →  extractionModel
structuring_model                 →  structuringModel
total_latency_ms                  →  totalLatencyMs
pipeline_mode                     →  pipelineMode
```

### 5b: Currency Conversion

The frontend displays costs in INR using a fixed rate:

```typescript
// lib/format.ts
const USD_TO_INR = 83;
costFmt(usd) → ₹{usd × 83}   // e.g. $0.0024 → ₹0.20
```

---

## 6. Where Cost Is Displayed in the UI

### Invoice Detail Page (`InvoiceDetailPage.tsx`)

**Invoice Fields grid** shows pipeline info + confidence:
```
┌─────────────────────────────────────────────────────────┐
│ INVOICE FIELDS                                          │
│ Pipeline      Single — gemini (gemini-2.5-flash)        │
│ Confidence    90%                                       │
└─────────────────────────────────────────────────────────┘
```

**Cost Breakdown card** (separate, below fields) — unified display:
```
┌─────────────────────────────────────────────────────────┐
│ COST BREAKDOWN              Single · gemini-2.5-flash · 12.9s │
│                                                         │
│ Input tokens            4,200 tokens  →  ₹0.10         │
│ Output tokens             363 tokens  →  ₹0.08         │
│ ───────────────────────────────────────────────────────  │
│ Total cost                      ₹0.18   4,563 tokens   │
└─────────────────────────────────────────────────────────┘
```

For **split mode**, also shows extraction + structuring in the fields grid:
```
│ Extraction    ₹0.08 · 2,000 tokens · mistral-ocr       │
│ Structuring   ₹0.12 · 2,563 tokens · gemini-2.5-flash  │
```

For **old invoices** (no input/output breakdown), falls back gracefully:
```
│ Total cost                      ₹0.20   4,563 tokens   │
```

### Invoice List Page (`InvoicesPage.tsx`)

- **COST column** shows `costFmt(costEstimate)` → e.g. `₹0.20`
- **Hover tooltip** shows:
  ```
  Input: 4,200 tkn = ₹0.10  +  Output: 363 tkn = ₹0.08  =  Total: ₹0.18
  ```
  Falls back to `4,563 tokens · ₹0.20` for old invoices.

### Settings Page (`SettingsPage.tsx`)

**Model Pricing** section shows an editable table:

```
┌──────────────────────┬────────────┬─────────────┬────────┐
│ Model                │ Input $/1M │ Output $/1M │        │
├──────────────────────┼────────────┼─────────────┼────────┤
│ gemini-2.5-flash     │      0.30  │       2.50  │        │
│ gemini-2.5-pro       │      1.25  │      10.00  │        │
│ gemini-3.5-flash     │      1.50  │       9.00  │        │
│ claude-sonnet-4      │      3.00  │      15.00  │ CUSTOM │
│ gpt-4o               │      2.50  │      10.00  │        │
│ mistral-ocr-latest   │      2.00  │       0.00  │        │
└──────────────────────┴────────────┴─────────────┴────────┘
                          [Save Pricing]
```

- Filter by provider (Gemini / Claude / OpenAI / Mistral)
- Edit any value → shows "CUSTOM" badge
- Reset button restores to default
- Save persists to Firestore → used for future cost calculations

### Analytics Page (`AnalyticsPage.tsx`)

- **API Costs tab** shows aggregated KPIs:
  - Total OCR runs, total cost (INR + USD)
  - Extraction vs Structuring cost breakdown
  - Average cost per OCR
  - Cost by provider table

### Shell Header

- Top bar shows lifetime: `17,312 OCR · ₹16,696.79 spent`

---

## 7. Complete Data Flow Diagram

```
     ┌──────────────┐
     │  PDF / Image  │
     └──────┬───────┘
            │
     ┌──────▼───────┐
     │  process.ts   │  reads AppSettings (mode, model, provider)
     └──────┬───────┘
            │
     ┌──────▼────────────────────────────────────────┐
     │  pipeline/single.ts  OR  pipeline/split.ts     │
     └──────┬────────────────────────────────────────┘
            │
     ┌──────▼────────────────────────────────────────┐
     │  Provider (Gemini / Claude / OpenAI / Mistral)  │
     │                                                 │
     │  API call → response includes:                  │
     │    prompt_tokens (input)                        │
     │    completion_tokens (output)                   │
     │    total_tokens                                 │
     └──────┬────────────────────────────────────────┘
            │
     ┌──────▼────────────────────────────────────────┐
     │  estimateCost() / estimateGeminiCostUsd()       │
     │                                                 │
     │  input_cost  = prompt_tokens × ($/1M ÷ 1M)     │
     │  output_cost = completion_tokens × ($/1M ÷ 1M)  │
     │  total_cost  = input_cost + output_cost         │
     │                                                 │
     │  → OcrStepCost { usage, cost_usd,               │
     │      input_cost_usd, output_cost_usd }          │
     └──────┬────────────────────────────────────────┘
            │
     ┌──────▼────────────────────────────────────────┐
     │  Pipeline builds OcrCostInfo                    │
     │                                                 │
     │  Single: extraction = stepCost                  │
     │  Split:  extraction = mistralCost               │
     │          structuring = llmCost                  │
     │  total_* = sum of all steps                     │
     └──────┬────────────────────────────────────────┘
            │
     ┌──────▼────────────────────────────────────────┐
     │  mapper.ts → mapParsedToBill()                  │
     │                                                 │
     │  Writes to BillDoc (Firestore):                 │
     │    total_cost_usd, total_input_tokens,          │
     │    total_output_tokens, total_input_cost_usd,   │
     │    total_output_cost_usd, extraction_model, ... │
     └──────┬────────────────────────────────────────┘
            │
     ┌──────▼────────────────────────────────────────┐
     │  mapper.ts → billToInvoice()                    │
     │                                                 │
     │  Maps snake_case → camelCase for API:           │
     │    costEstimate, totalInputTokens,              │
     │    totalOutputTokens, totalInputCostUsd,        │
     │    totalOutputCostUsd, ...                      │
     └──────┬────────────────────────────────────────┘
            │
     ┌──────▼────────────────────────────────────────┐
     │  Frontend                                       │
     │                                                 │
     │  costFmt(usd) = ₹{usd × 83}                    │
     │                                                 │
     │  InvoiceDetailPage: shows input/output tokens   │
     │    + cost per side + total                      │
     │  InvoicesPage: COST column + tooltip breakdown  │
     │  SettingsPage: editable model pricing table     │
     └────────────────────────────────────────────────┘
```

---

## 8. Example: Real Cost Calculation

**Model:** gemini-2.5-flash (default)
**Pricing:** Input $0.30/1M, Output $2.50/1M

**API returns:**
```json
{
  "usageMetadata": {
    "promptTokenCount": 4200,
    "candidatesTokenCount": 363,
    "totalTokenCount": 4563
  }
}
```

**Calculation:**
```
input_cost  = 4200 / 1,000,000 × $0.30  = $0.00126
output_cost = 363  / 1,000,000 × $2.50  = $0.0009075
total_cost  = $0.00126 + $0.0009075      = $0.0021675

Display (INR): $0.0021675 × 83 = ₹0.18
```

**Stored in Firestore:**
```
total_cost_usd: 0.0022
total_input_tokens: 4200
total_output_tokens: 363
total_input_cost_usd: 0.0013
total_output_cost_usd: 0.0009
extraction_model: "gemini-2.5-flash"
pipeline_mode: "single"
```

---

## 9. How to Update Pricing

### Option A: From Settings UI
1. Go to Settings → Model Pricing
2. Edit input/output values for any model
3. Click "Save Pricing"
4. Overrides saved to Firestore `AppSettings.modelPricing`
5. All future OCR uses the new rates

### Option B: Change code defaults
1. Edit `shared/modelPricing.ts` → `DEFAULT_MODEL_PRICING`
2. Update `providers/geminiClient.ts` → `GEMINI_MODEL_PRICING` (for Gemini)
3. Deploy — new defaults apply to all users without UI overrides

### Option C: Pricing for a new model
1. Add entry to `DEFAULT_MODEL_PRICING` in `shared/modelPricing.ts`
2. If Gemini: also add to `GEMINI_MODEL_PRICING` in `geminiClient.ts`
3. If non-Gemini: update the `pricing` field in the provider's `PROVIDERS` config
4. Model automatically appears in Settings UI pricing table

---

## 10. Key Files Reference

| File | Role |
|------|------|
| `shared/modelPricing.ts` | Default pricing table + `resolveModelPricing()` |
| `shared/settings.ts` | `AppSettings.modelPricing` — user overrides |
| `ocr/types/provider.ts` | `LlmUsage`, `OcrStepCost`, `OcrCostInfo` types |
| `ocr/providers/geminiClient.ts` | Gemini pricing + `estimateGeminiCostUsd()` |
| `ocr/providers/llmSingle.ts` | Single-call cost calc (Claude/OpenAI/Mistral) |
| `ocr/providers/llmNormalize.ts` | Structuring cost calc (split mode step 2) |
| `ocr/providers/mistralOcr.ts` | Mistral OCR page-based cost |
| `ocr/pipeline/single.ts` | Builds `OcrCostInfo` for single mode |
| `ocr/pipeline/split.ts` | Builds `OcrCostInfo` for split mode |
| `ocr/mapper.ts` | Persists cost to BillDoc + maps to frontend |
| `routes/settings.ts` | GET/PUT `/api/settings` — exposes pricing |
| `shared/types.ts` | `BillDoc` cost fields definition |
| `web/src/pages/SettingsPage.tsx` | Pricing editor UI |
| `web/src/pages/InvoiceDetailPage.tsx` | Cost breakdown display |
| `web/src/pages/InvoicesPage.tsx` | Cost column + tooltip |
| `web/src/lib/format.ts` | `costFmt()` — USD→INR conversion |
