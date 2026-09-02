# Development Workflow

## When to Use OpenSpec

- **Required:** Feature additions, bug fixes touching business logic, OCR/GST changes, API changes, contract changes.
- **Optional:** Typo fixes, docs-only changes, trivial config updates.

## Lifecycle

```
/opsx-explore   → Understand codebase before proposing changes
/opsx-propose   → Create proposal, specs, design, tasks
                → STOP — wait for human review (GATE 2)
/opsx-apply     → Implement tasks in order (after GATE 3 approval)
                → Run tests, typecheck, build
                → AI code review
                → Verification checklist
/opsx-archive   → Archive after implementation + verification complete
```

## Human Approval Gates

| Gate | When | What |
|------|------|------|
| GATE 1 | Before planning | Confirm requirement and scope |
| GATE 2 | After proposal + specs + design + tasks | Review and approve the plan |
| GATE 3 | Before /opsx-apply | Confirm ready to implement |
| GATE 4 | After implementation | Review changes before merge |
| GATE 5 | Before production deploy | For high-risk changes only |

AI agents must not assume approval at any gate.

## Verification Checklist

Before declaring a change complete:

1. All OpenSpec tasks done
2. Acceptance criteria met
3. Relevant tests pass
4. Full test suite passes (when backend changes)
5. `npx tsc --noEmit` passes (platform/)
6. Build succeeds
7. `git diff --stat` — only scoped files changed
8. No secrets or debug code introduced
9. No existing behavior broken

## Common Commands

```bash
# Platform tests
cd platform && npx vitest run

# Specific test file
cd platform && npx vitest run tests/ocr/extraction/normalize.test.ts

# Typecheck
cd platform && npx tsc --noEmit

# OpenSpec validation
openspec validate <change-name>

# OpenSpec status
openspec status --change <change-name>
```
