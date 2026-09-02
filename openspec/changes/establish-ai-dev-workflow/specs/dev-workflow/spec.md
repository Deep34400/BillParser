## ADDED Requirements

### Requirement: REQ-DW-1: OpenSpec lifecycle for meaningful changes

Every meaningful feature or bug-fix change must follow the OpenSpec lifecycle: proposal → specs → design → tasks → human approval → implementation → tests → typecheck → build → review → verification → archive. Trivial changes (typo, docs-only) may skip OpenSpec.

#### Scenario: Developer proposes an OCR accuracy fix

- **Given** a developer identifies a reconciliation bug
- **When** they begin the change
- **Then** they must create an OpenSpec proposal before writing implementation code
- **And** the proposal must be approved at GATE 2 before /opsx-apply

#### Scenario: Trivial documentation fix skips OpenSpec

- **Given** a developer fixes a typo in a README
- **When** the change touches no runtime code
- **Then** OpenSpec is not required

### Requirement: REQ-DW-2: Five human approval gates

The workflow enforces five gates: (1) Requirement/scope, (2) Proposal+design+tasks, (3) Before implementation, (4) After implementation / before merge, (5) Before production deployment for high-risk changes. AI agents must not assume approval.

#### Scenario: AI agent attempts implementation without GATE 3

- **Given** an OpenSpec change with approved proposal and tasks
- **When** the AI agent attempts to apply changes
- **Then** it must confirm human approval before modifying source files

### Requirement: REQ-DW-3: Cursor rules encode project conventions

Cursor project rules under `.cursor/rules/` must encode architecture, OCR safety, API patterns, frontend client usage, testing, and security conventions so AI agents receive them automatically.

#### Scenario: AI agent edits OCR transformer file

- **Given** the agent opens a file under `platform/src/ocr/transformer/`
- **When** Cursor loads project context
- **Then** the `ocr-gst-safety.mdc` rule is active and instructs test-first discipline

### Requirement: REQ-DW-4: Verification checklist before completion

Before declaring any change complete, the implementer must: run relevant tests, run typecheck, run build, inspect git diff, confirm no unrelated files changed, confirm no secrets introduced.

#### Scenario: Implementation passes tests but has unrelated file changes

- **Given** tests pass after implementation
- **When** git diff shows modifications to files outside the OpenSpec scope
- **Then** the change must NOT be declared complete until unrelated changes are removed

### Requirement: REQ-DW-5: OpenSpec config encodes project context

`openspec/config.yaml` must contain the project's architecture summary, critical contracts, and per-artifact guidance so AI agents have authoritative context during planning.

#### Scenario: AI agent runs /opsx-propose

- **Given** the agent invokes /opsx-propose
- **When** OpenSpec loads config.yaml
- **Then** the agent receives project architecture context and safety rules
