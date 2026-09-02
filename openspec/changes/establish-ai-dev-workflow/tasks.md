## Tasks

### Task 1: Update `openspec/config.yaml`

- **What:** Populate config with project name, schema (`spec-driven`), tech stack, architecture summary, critical contracts (`ParsedInvoiceData`), per-artifact guidance (proposal, specs, design, tasks), and apply/archive operation rules.
- **Where:** `openspec/config.yaml`
- **Tests:** `openspec validate establish-ai-dev-workflow` passes.
- **Acceptance:** Config references actual repository paths. No runtime code paths are invented. Schema is `spec-driven`.
- **Verification:** `openspec status` shows config loaded correctly.

### Task 2: Create `.cursor/rules/always-architecture.mdc`

- **What:** Cursor rule (alwaysApply: true) encoding: route→service→repo pattern, module boundaries (platform/src/ocr, shared, analytics, fraud, users, vendor, email-intake), business logic in services not routes, Firestore persistence.
- **Where:** `.cursor/rules/always-architecture.mdc`
- **Tests:** N/A (documentation-only).
- **Acceptance:** Rule is concise (<80 lines). Covers architecture and module boundaries. Uses `alwaysApply: true`.
- **Verification:** File exists and is valid MDC format.

### Task 3: Create `.cursor/rules/ocr-gst-safety.mdc`

- **What:** Cursor rule (glob: `platform/src/ocr/**`) encoding: test-first for OCR/GST changes, non-regression matrix (IGST, CGST+SGST, Free/FOC, fuel 0%, labour-only GST, parts-only, parts+labour, deductibles, mixed taxable/non-taxable, provider fallback), prefer narrow fixes, `ParsedInvoiceData` contract immutability, numerical verification.
- **Where:** `.cursor/rules/ocr-gst-safety.mdc`
- **Tests:** N/A.
- **Acceptance:** Rule is concise (<60 lines). Covers all REQ-OCR-* requirements.
- **Verification:** File exists with correct glob pattern.

### Task 4: Create `.cursor/rules/api-domain.mdc`

- **What:** Cursor rule (glob: `platform/src/*/route*`) encoding: thin controllers, no business logic in route handlers, delegate to services, validate inputs at route boundary.
- **Where:** `.cursor/rules/api-domain.mdc`
- **Tests:** N/A.
- **Acceptance:** Rule is concise (<30 lines).
- **Verification:** File exists.

### Task 5: Create `.cursor/rules/web-api-client.mdc`

- **What:** Cursor rule (glob: `web/src/**`) encoding: use `web/src/api/client.ts` for HTTP calls, no duplicate API clients, prefer backend-provided derived values, document any intentional frontend calculation mirroring.
- **Where:** `.cursor/rules/web-api-client.mdc`
- **Tests:** N/A.
- **Acceptance:** Rule is concise (<30 lines).
- **Verification:** File exists.

### Task 6: Create `.cursor/rules/testing.mdc`

- **What:** Cursor rule (glob: `platform/tests/**,web/tests/**`) encoding: Vitest, test placement conventions, no weakening existing tests, failing test before implementation for bug fixes, test levels (unit/integration/API/component/e2e).
- **Where:** `.cursor/rules/testing.mdc`
- **Tests:** N/A.
- **Acceptance:** Rule is concise (<40 lines).
- **Verification:** File exists.

### Task 7: Create `.cursor/rules/security.mdc`

- **What:** Cursor rule (alwaysApply: true) encoding: no secrets in code, no .env commits, no hardcoded API keys, no auth bypass, no credential logging, no unsafe dynamic code, security-sensitive changes require review.
- **Where:** `.cursor/rules/security.mdc`
- **Tests:** N/A.
- **Acceptance:** Rule is concise (<25 lines).
- **Verification:** File exists.

### Task 8: Create `openspec/WORKFLOW.md`

- **What:** Short developer-facing guide covering: when to use OpenSpec, the lifecycle (/opsx-explore → /opsx-propose → human review → /opsx-apply → testing → verification → /opsx-archive), five human approval gates, verification checklist, common commands.
- **Where:** `openspec/WORKFLOW.md`
- **Tests:** N/A.
- **Acceptance:** Document is <100 lines. Covers all gates and commands. Does not duplicate rule content.
- **Verification:** File exists and is readable.

### Task 9: Final verification

- **What:** Run `openspec validate establish-ai-dev-workflow`. Verify all files exist. Confirm no `platform/src/` or `web/src/` files were modified. Run `git diff --stat` to confirm scope.
- **Where:** Terminal.
- **Tests:** `openspec validate` passes. `git diff --stat` shows only `openspec/` and `.cursor/` files.
- **Acceptance:** All 8 files created/updated. No runtime code touched. Validation passes.
- **Verification:** Clean validation output and scoped git diff.
