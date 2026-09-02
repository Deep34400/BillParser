## Why

AI-assisted changes to this codebase — especially the OCR/GST/reconciliation pipeline — have been applied ad hoc, risking regressions on unrelated invoice formats. There is no standard gate between planning and implementation, no enforced test-before-implement discipline, and no machine-readable project context for Cursor agents. We need a production-grade workflow so every meaningful change follows: requirement → investigation → plan → human approval → implementation → tests → typecheck → review → verification → merge → archive.

## What Changes

- Populate `openspec/config.yaml` with authoritative project context, per-artifact rules, and apply/archive operation guidance derived from the actual repository structure.
- Add Cursor project rules under `.cursor/rules/` (architecture, OCR/GST safety, API routes, web client, testing, security) that enforce safe AI-assisted development.
- Add a short developer-facing workflow guide (`openspec/WORKFLOW.md`) explaining the OpenSpec + Cursor lifecycle, human approval gates, testing requirements, and verification checklist.
- Define five human approval gates (scope, plan, pre-apply, pre-merge, pre-deploy for high-risk).
- Codify the OCR/GST non-regression matrix (IGST, CGST+SGST, Free/FOC, fuel 0%, labour-only GST, parts-only + deductibles, mixed taxable/non-taxable, provider fallback).
- Codify the immutable `ParsedInvoiceData` contract rule and require a dedicated OpenSpec change for any field rename/removal.

**No application runtime code changes.** Only `openspec/`, `.cursor/rules/`, and workflow documentation are modified.

## Capabilities

### New Capabilities

- `dev-workflow`: Standard AI-assisted development lifecycle using OpenSpec + Cursor for this repository — planning gates, human approval checkpoints, implementation rules, verification checklist, git/PR practices, and archive discipline.
- `ocr-change-safety`: Guardrails for changes touching OCR parsing, GST calculation, enrichment, reconciliation, or the `ParsedInvoiceData` contract — tests-first discipline, non-regression invoice-format matrix, narrow-guard preference, numerical verification.

### Modified Capabilities

(none — `openspec/specs/` has no existing capabilities yet)

## Impact

- **Files created/modified:** `openspec/config.yaml`, `.cursor/rules/*.mdc` (6 files), `openspec/WORKFLOW.md`. After archive: `openspec/specs/dev-workflow/spec.md`, `openspec/specs/ocr-change-safety/spec.md`.
- **No runtime behavior change** in `platform/src/` or `web/src/`.
- **Developer experience:** Future changes require planning before implementation; OCR changes require regression tests. Initial overhead is higher; regression risk is lower.
- **Existing tests:** Not modified. Pre-existing failures (billMapper, resolveKey pricing, some web tests) remain out of scope.
