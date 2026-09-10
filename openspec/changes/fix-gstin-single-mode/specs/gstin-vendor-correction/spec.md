## MODIFIED Requirements

### Requirement: GSTIN-1: Seller/buyer GSTIN correction applies in all pipeline modes

Currently `resolveVendorFromMarkdown` only corrects the GSTIN when the markdown parameter contains real OCR text (split mode). In single mode, the markdown parameter is either empty or contains LLM JSON, so correction is skipped. After this change, single-mode pipelines must also provide real OCR markdown to the correction logic.

#### Scenario: Single-mode Gemini extracts buyer GSTIN — correction fixes it

- **Given** an invoice processed in single mode via Gemini
- **And** the invoice shows buyer GSTIN "27AALCC8489R1ZD" at the top under "Cust GSTIN/UIN"
- **And** the invoice shows dealer GSTIN "33AABCT1234R1ZX" at the bottom under "Dealer GSTIN"
- **When** Gemini returns `gstin: "27AALCC8489R1ZD"` (buyer)
- **Then** `resolveVendorFromMarkdown` receives OCR markdown (not JSON)
- **And** the final `parsed.gstin` is `"33AABCT1234R1ZX"` (seller/dealer)

#### Scenario: Split-mode behavior unchanged

- **Given** an invoice processed in split mode (Mistral OCR → LLM structuring)
- **When** the pipeline runs enrichment with OCR markdown
- **Then** vendor correction works exactly as before — no behavior change

#### Scenario: Single-mode where LLM picks correct seller GSTIN

- **Given** an invoice where the LLM correctly returns the seller's GSTIN
- **When** vendor correction runs with OCR markdown
- **Then** `shouldFix` is false and the correct GSTIN is preserved unchanged

#### Scenario: AzAPI provider also gets vendor correction

- **Given** an invoice processed via AzAPI provider
- **When** AzAPI returns `gstin` from its response
- **Then** vendor correction runs against OCR markdown (if available) to verify/correct the GSTIN

#### Scenario: No regression on existing vendor extraction tests

- **Given** all existing tests in `platform/tests/ocr/extraction/vendorExtract.test.ts`
- **When** the test suite runs after implementation
- **Then** all existing tests pass without modification
