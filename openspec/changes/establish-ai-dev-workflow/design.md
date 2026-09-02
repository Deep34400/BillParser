## Context

This repository has a Fastify backend (`platform/`), React/Vite frontend (`web/`), and a critical OCR/GST invoice processing pipeline under `platform/src/ocr/`. Recent changes to GST calculation, Free-item handling, and reconciliation were applied without a structured planning/testing workflow, leading to cascading regressions. OpenSpec and Cursor rules will establish guardrails.

## Goals

1. Every meaningful change follows a plan-first, test-first lifecycle with human approval gates.
2. AI agents receive authoritative project context via `openspec/config.yaml` and `.cursor/rules/`.
3. OCR/GST changes have mandatory regression tests and a non-regression matrix.
4. `ParsedInvoiceData` is protected as an immutable contract.
5. No runtime code is modified by this change.

## Non-Goals

- Refactoring existing code or fixing existing test failures.
- Adding CI/CD pipeline configuration.
- Creating end-to-end test infrastructure.

## Decisions

### D1: Schema = `spec-driven`

The `spec-driven` OpenSpec schema fits this project: proposal → specs → design → tasks → archive. It enforces capability-based specifications with scenarios.

### D2: Two capabilities for this change

- `dev-workflow`: Lifecycle, gates, Cursor rules, config, verification.
- `ocr-change-safety`: OCR/GST-specific guardrails, test matrix, contract protection.

Splitting keeps each spec focused on one concern per OpenSpec principles.

### D3: Six Cursor rule files

| Rule file | Scope | Purpose |
|---|---|---|
| `always-architecture.mdc` | Always | Route→service→repo pattern, module boundaries |
| `ocr-gst-safety.mdc` | `platform/src/ocr/**` | Test-first, non-regression matrix, narrow fixes |
| `api-domain.mdc` | `platform/src/*/route*` | Thin controllers, no business logic in routes |
| `web-api-client.mdc` | `web/src/**` | Use `api/client.ts`, no duplicate HTTP clients |
| `testing.mdc` | `platform/tests/**`, `web/tests/**` | Vitest conventions, test placement, no weakening |
| `security.mdc` | Always | No secrets, no .env commits, no auth bypass |

### D4: Config keeps project context concise

`openspec/config.yaml` includes: project name, tech stack, architecture summary, critical contracts, per-artifact guidance. It does NOT duplicate the full rules — Cursor rules handle enforcement.

### D5: Workflow doc is one file

`openspec/WORKFLOW.md` — a short reference for the lifecycle, gates, commands, and verification checklist. Avoids sprawling documentation.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Overhead for small changes | Trivial changes (typo/docs) can skip OpenSpec |
| AI agents ignore Cursor rules | Rules are auto-loaded by file glob; critical ones use `alwaysApply: true` |
| Config becomes stale | Config references actual paths; verified during this change |

## Migration

No data migration. After applying this change, the workflow is active for all future changes. Existing in-progress work is unaffected.
