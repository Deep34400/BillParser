## ADDED Requirements

### Requirement: REQ-OCR-1: Tests-first for OCR/GST changes

Any change touching OCR parsing, normalization, enrichment, GST calculation, invoice totals, reconciliation, Free/FOC items, labour-only GST, fallback model selection, provider selection, deductibles, or rate inheritance must include a failing regression test BEFORE implementation.

#### Scenario: Fix for Free item taxable amount

- **Given** a bug where Free items have non-zero taxable_amount
- **When** the developer begins implementation
- **Then** a failing test asserting taxable_amount === 0 for Free items must exist first
- **And** the test must pass after implementation without weakening other tests

### Requirement: REQ-OCR-2: Non-regression invoice-format matrix

OCR/GST changes must verify non-regression across at minimum: IGST invoices, CGST+SGST invoices, Free/FOC items, fuel 0% items, labour-only GST, parts-only invoices, parts+labour, deductibles, mixed taxable/non-taxable items, existing invoice formats, OCR provider fallback.

#### Scenario: Fix for labour-only GST must not break IGST invoices

- **Given** a change to clear spurious parts GST on labour-only estimates
- **When** the full test suite runs
- **Then** all existing IGST invoice tests still pass

### Requirement: REQ-OCR-3: Prefer narrow guards over pipeline rewrites

OCR/GST bug fixes must prefer the smallest safe change. Full pipeline rewrites require explicit OpenSpec design justification proving necessity.

#### Scenario: Mixed tax rate discount allocation bug

- **Given** a discount allocation bug in sideTax for mixed rates
- **When** the developer proposes a fix
- **Then** the OpenSpec design must show why a targeted fix in sideTax is sufficient
- **And** must NOT rewrite reconcileInvoiceTotal unless proven necessary

### Requirement: REQ-OCR-4: ParsedInvoiceData contract immutability

Any rename, removal, or semantic change to fields in `ParsedInvoiceData` (platform/src/shared/types.ts) requires a dedicated OpenSpec change with impact analysis, migration plan, consumer audit, and explicit human approval.

#### Scenario: Agent attempts to rename a ParsedInvoiceData field

- **Given** an AI agent proposes renaming `parts_cgst_amount` to `parts_gst_cgst`
- **When** the change is evaluated
- **Then** it must be rejected unless it has its own OpenSpec change with migration plan

### Requirement: REQ-OCR-5: Numerical verification for calculation changes

OpenSpec specs for GST/total calculation changes must include expected numerical results for at least one concrete invoice example.

#### Scenario: GST calculation change includes numerical expectation

- **Given** a change to sideTax discount allocation
- **When** the spec is written
- **Then** it must include at least one example with concrete input numbers and expected tax output
