# GLM-OCR via Ollama — Local Extraction Provider + Structuring Backend

Date: 2026-06-20
Status: Approved (design)

## Goal

Add a fully local invoice extraction path using **GLM-OCR running on Ollama**, with
no cloud calls and no API keys. GLM-OCR serves two roles:

1. A `markdown`-kind **extraction provider** (`ollama`): reads invoice page images and
   emits markdown/text.
2. A local **structuring backend** (`ollama`): turns OCR markdown into the canonical
   JSON fields.

This lets the entire pipeline (OCR → structuring) run on-device.

## Environment (user-provided)

- Ollama base URL: `http://host.docker.internal:11434` (Ollama on host; API runs in Docker).
- OCR model tag: `glm-ocr`.
- Structuring model: `glm-ocr` (same model).

## Data flow

```
PDF → rasterize to PNG(s) → glm-ocr (vision)  → markdown
     → glm-ocr (JSON mode)                     → canonical fields → DB
```

## Architecture

Mirrors the existing provider abstraction:

- Extraction providers implement `ExtractionProvider` (`api/src/providers/types.ts`).
  `markdown`-kind providers produce raw markdown, then `getStructuringModel()` turns it
  into `CanonicalResult` fields. The Mistral provider is the reference pattern.
- Structuring backends implement `StructuringModel` (`api/src/structuring/types.ts`) and
  are selected in `getStructuringModel()` (`api/src/structuring/index.ts`) by the
  `structuring_provider` setting.

Ollama needs **images, not PDFs**, and the project currently has no rasterizer (only
`pdf-lib` page counting). The main new infrastructure is a PDF→PNG rasterizer backed by
`poppler-utils` (`pdftoppm`), installed into the API Docker image.

## New components

### 1. `api/src/lib/rasterize.ts`

```
rasterizePdf(buf: Buffer, opts?: { dpi?: number; maxPages?: number }): Promise<string[]>
```

- Defaults: `dpi = 200`, `maxPages = 5`.
- Writes `buf` to a fresh temp dir (`mkdtemp`), runs
  `pdftoppm -png -r <dpi> [-l <maxPages>] input.pdf out`, reads the generated
  `out-*.png` files, returns them base64-encoded (page order), then removes the temp dir.
- Throws a clear error if the input is not a PDF or if `pdftoppm` is unavailable.

### 2. `api/src/lib/ollama.ts`

```
ollamaChat(baseUrl, model, prompt, opts?: { images?: string[]; json?: boolean }): Promise<string>
```

- Single place for `POST {baseUrl}/api/chat` with `{ model, messages: [{ role:'user',
  content: prompt, images? }], stream:false, format: json ? 'json' : undefined }`.
- Returns `message.content`.
- AbortController timeout ~180s (local vision models are slow).
- Errors: connection refused → message naming `baseUrl` and the `host.docker.internal`
  hint; non-200 → status + truncated body.

### 3. `api/src/providers/ollama.ts` — extraction provider

- `name: 'ollama'`, `displayName: 'GLM-OCR (Ollama)'`, `kind: 'markdown'`.
- `requiredCredentials: ['baseUrl', 'model']`; `isConfigured = !!c?.baseUrl && !!c?.model`.
- `extract(file, creds, ctx)`:
  1. `rasterizePdf(file)` → base64 PNGs.
  2. `ollamaChat(creds.baseUrl, creds.model, OCR_PROMPT, { images })` → markdown.
  3. `getStructuringModel()` → `model.structure(markdown, sCreds)` → fields.
  4. Return `{ ...fields, rawText: markdown, rawJson: <ollama response> }`.
- `OCR_PROMPT`: instruct the model to transcribe the invoice to clean markdown,
  preserving tables.

### 4. `api/src/structuring/ollama.ts` — structuring backend

- `ollamaStructModel(model): StructuringModel` with `provider: 'ollama'`.
- `structure(markdown, creds)`:
  `ollamaChat(creds.baseUrl, model, STRUCTURING_PROMPT + "\n\nOCR markdown:\n" + markdown,
  { json: true })` → `normalizeStructured(text)`.
- Reuses the existing `STRUCTURING_PROMPT` and `normalizeStructured`.

## Wiring (small edits)

- `api/src/providers/registry.ts` — add `ollamaProvider` to `REGISTRY` (auto-surfaces in
  `/api/config` → Settings extraction list).
- `api/src/structuring/index.ts` — add `ollama: ollamaStructModel` to the impl map.
  Structuring creds reuse the OCR provider config via the existing fallback
  `getCredentials('structuring_ollama') ?? getCredentials('ollama')`, so baseUrl/model are
  entered once.
- `api/src/routes/config.ts` — include `requiredCredentials` in each provider entry so the
  Settings UI renders the baseUrl/model fields. (Confirm/add; `ProviderInfo` already has
  the optional field.)
- `api/src/extraction/confidence.ts` — `estimateCost('ollama') = 0` (local/free).
- `web/src/pages/SettingsPage.tsx` — add `{ name: 'ollama', label: 'GLM-OCR (Ollama)' }` to
  `STRUCTURING_PROVIDERS` and a structuring cred label. `baseUrl`/`model` are not in
  `SECRET_FIELDS`, so they render as plain text fields automatically. Prefill defaults
  `http://host.docker.internal:11434` and `glm-ocr`.
- `api/Dockerfile` — add `poppler-utils` to the apt installs in both the build and runtime
  stages.

## Config / credentials

- `ProviderConfig['ollama'] = { baseUrl, model }` — no secret stored.
- `isConfigured` requires both fields. Defaults offered in the UI; one Save configures both
  the OCR provider and the local structuring step.

## Error handling

Rasterize failure (not a PDF / missing `pdftoppm`), Ollama unreachable, non-200, timeout,
or unparseable JSON all throw and are caught by `runExtraction`, which marks the invoice
`FAILED` with a readable message — identical to every other provider.

## Testing

- `api/tests/structuring/ollama.test.ts` — mock `fetch`; assert markdown → normalized
  fields, and that `format: 'json'` is requested.
- `api/tests/providers/ollama.test.ts` — mock the rasterizer and `fetch`; assert page
  images are sent to `/api/chat` and the resulting markdown flows into structuring.
- `api/tests/lib/rasterize.test.ts` — generate a 1-page PDF with `pdf-lib` (as
  `run.test.ts` does), rasterize, assert PNG magic bytes. **Guarded to skip when
  `pdftoppm` is not on the host**; runs in the container/CI where poppler is installed.

## Out of scope (YAGNI)

No streaming, no per-page parallelism, no configurable DPI/prompt in the UI (constants for
now), no automatic `ollama pull` of the model.
