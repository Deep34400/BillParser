# GLM-OCR via Ollama — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully local invoice extraction path — GLM-OCR on Ollama as both a `markdown` extraction provider and a local structuring backend — so OCR and field-structuring run on-device with no cloud calls or API keys.

**Architecture:** A new `pdftoppm`-backed rasterizer turns PDFs into page PNGs; a shared Ollama `/api/chat` client sends those images to `glm-ocr` for markdown, then sends the markdown back to `glm-ocr` (JSON mode) for canonical fields. The provider mirrors the existing Mistral `markdown` pattern; the structuring backend plugs into the existing `getStructuringModel()` registry. Credentials (`baseUrl`, `model`) are entered once and reused by both roles.

**Tech Stack:** Node 20 (ESM, global `fetch`/`AbortSignal.timeout`), Fastify, Prisma, Vitest, `pdf-lib` (test fixtures), `poppler-utils` (`pdftoppm`), React (Settings UI), Docker.

**Working directory for all `npx`/`git` commands:** `api/` (except the web task, noted inline). All API source imports use explicit `.js` extensions (ESM).

---

## File structure

- Create `api/src/lib/rasterize.ts` — PDF → base64 PNG pages via `pdftoppm`.
- Create `api/src/lib/ollama.ts` — shared `POST /api/chat` client with timeout + clear errors.
- Create `api/src/structuring/ollama.ts` — `StructuringModel` backend (markdown → JSON fields).
- Create `api/src/providers/ollama.ts` — `markdown`-kind extraction provider (rasterize → OCR → structure).
- Modify `api/src/structuring/index.ts` — register `ollama` in the impl map.
- Modify `api/src/providers/registry.ts` — register `ollamaProvider`.
- Modify `api/src/providers/reference.ts` — add `ollama` cost row (free).
- Modify `web/src/pages/SettingsPage.tsx` — add Ollama as a (keyless) structuring option; default-fill baseUrl/model.
- Modify `api/Dockerfile` — install `poppler-utils` in build + runtime stages.
- Tests: `api/tests/lib/rasterize.test.ts`, `api/tests/lib/ollama.test.ts`, `api/tests/structuring/ollama.test.ts`, `api/tests/providers/ollama.test.ts`.

---

## Task 1: PDF rasterizer

**Files:**
- Create: `api/src/lib/rasterize.ts`
- Test: `api/tests/lib/rasterize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/tests/lib/rasterize.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';
import { rasterizePdf } from '../../src/lib/rasterize.js';

const exec = promisify(execFile);
// Present even if it exits non-zero (usage error); only ENOENT means "not installed".
async function hasPdftoppm(): Promise<boolean> {
  try { await exec('pdftoppm', ['-h']); return true; }
  catch (e: any) { return e?.code !== 'ENOENT'; }
}

async function onePagePdf(): Promise<Buffer> {
  const d = await PDFDocument.create();
  d.addPage();
  return Buffer.from(await d.save());
}

describe('rasterizePdf', () => {
  it('rejects non-PDF input', async () => {
    await expect(rasterizePdf(Buffer.from('not a pdf'))).rejects.toThrow(/not a PDF/i);
  });

  it('renders a PDF to base64 PNG pages', async () => {
    if (!(await hasPdftoppm())) {
      console.warn('skipping: pdftoppm not installed on host');
      return;
    }
    const pages = await rasterizePdf(await onePagePdf());
    expect(pages.length).toBeGreaterThanOrEqual(1);
    const png = Buffer.from(pages[0], 'base64');
    // PNG magic bytes
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/rasterize.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/rasterize.js'` (or "rasterizePdf is not a function").

- [ ] **Step 3: Write the implementation**

Create `api/src/lib/rasterize.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPdf } from './pdf.js';

const exec = promisify(execFile);

// Rasterize a PDF to one base64-encoded PNG per page using poppler's pdftoppm.
// Ollama vision models accept images, not PDFs. dpi trades quality vs payload size;
// maxPages caps huge documents.
export async function rasterizePdf(
  buf: Buffer,
  opts: { dpi?: number; maxPages?: number } = {},
): Promise<string[]> {
  const dpi = opts.dpi ?? 200;
  const maxPages = opts.maxPages ?? 5;
  if (!isPdf(buf)) throw new Error('rasterizePdf: input is not a PDF');

  const dir = await mkdtemp(join(tmpdir(), 'ioc-raster-'));
  try {
    const input = join(dir, 'input.pdf');
    await writeFile(input, buf);
    const args = ['-png', '-r', String(dpi), '-l', String(maxPages), input, join(dir, 'page')];
    try {
      await exec('pdftoppm', args);
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        throw new Error('rasterizePdf: pdftoppm not found — install poppler-utils.');
      }
      throw new Error(`rasterizePdf: pdftoppm failed: ${String(e?.stderr ?? e?.message ?? e)}`);
    }
    const files = (await readdir(dir))
      .filter((f) => f.startsWith('page') && f.endsWith('.png'))
      .sort();
    const pages = await Promise.all(
      files.map((f) => readFile(join(dir, f)).then((b) => b.toString('base64'))),
    );
    if (!pages.length) throw new Error('rasterizePdf: no pages rendered');
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/rasterize.test.ts`
Expected: PASS (2 tests). On a host without poppler, the render test logs a skip warning and still passes; the non-PDF test always runs.

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/rasterize.ts api/tests/lib/rasterize.test.ts
git commit -m "feat(ocr): add pdftoppm-backed PDF rasterizer"
```

---

## Task 2: Ollama chat client

**Files:**
- Create: `api/src/lib/ollama.ts`
- Test: `api/tests/lib/ollama.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/tests/lib/ollama.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ollamaChat } from '../../src/lib/ollama.js';

afterEach(() => vi.restoreAllMocks());

describe('ollamaChat', () => {
  it('POSTs to /api/chat and returns message.content', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: 'hello md' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await ollamaChat('http://host.docker.internal:11434/', 'glm-ocr', 'PROMPT', {
      images: ['BASE64IMG'],
      json: true,
    });

    expect(out).toBe('hello md');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://host.docker.internal:11434/api/chat');
    const body = JSON.parse((init as any).body);
    expect(body.model).toBe('glm-ocr');
    expect(body.stream).toBe(false);
    expect(body.format).toBe('json');
    expect(body.messages[0].images).toEqual(['BASE64IMG']);
  });

  it('throws a clear error on non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(ollamaChat('http://x:11434', 'glm-ocr', 'P')).rejects.toThrow(/Ollama HTTP 500/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/lib/ollama.test.ts`
Expected: FAIL — cannot find module `../../src/lib/ollama.js`.

- [ ] **Step 3: Write the implementation**

Create `api/src/lib/ollama.ts`:

```ts
const TIMEOUT_MS = 180_000; // local vision models are slow

// Single entry point for Ollama's /api/chat. Returns the assistant message text.
// Pass images (base64 PNGs) for vision; pass json:true to force JSON output.
export async function ollamaChat(
  baseUrl: string,
  model: string,
  prompt: string,
  opts: { images?: string[]; json?: boolean } = {},
): Promise<string> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;
  const message: Record<string, unknown> = { role: 'user', content: prompt };
  if (opts.images?.length) message.images = opts.images;
  const body: Record<string, unknown> = { model, messages: [message], stream: false };
  if (opts.json) body.format = 'json';

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e: any) {
    if (e?.name === 'TimeoutError') {
      throw new Error(`Ollama request to ${url} timed out after ${TIMEOUT_MS / 1000}s (model "${model}").`);
    }
    throw new Error(
      `Could not reach Ollama at ${baseUrl}. Is it running? From Docker use host.docker.internal. (${String(e?.message ?? e)})`,
    );
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 400);
    throw new Error(`Ollama HTTP ${res.status} at ${url} (model "${model}"). ${detail}`);
  }
  const j: any = await res.json();
  return j?.message?.content ?? '';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/lib/ollama.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/ollama.ts api/tests/lib/ollama.test.ts
git commit -m "feat(ocr): add shared Ollama /api/chat client"
```

---

## Task 3: Ollama structuring backend

**Files:**
- Create: `api/src/structuring/ollama.ts`
- Modify: `api/src/structuring/index.ts` (impl map, lines ~5-6 imports and ~38-40 map)
- Test: `api/tests/structuring/ollama.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/tests/structuring/ollama.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ollamaStructModel } from '../../src/structuring/ollama.js';

afterEach(() => vi.restoreAllMocks());

describe('ollamaStructModel', () => {
  it('sends markdown in JSON mode and normalizes the result', async () => {
    const json = JSON.stringify({
      vendorName: 'Globex', invoiceNumber: 'INV-9', totalAmount: '100', currency: 'USD',
      lineItems: [{ description: 'Item A', quantity: 2, amount: 20 }],
    });
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: json } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const model = ollamaStructModel('glm-ocr');
    const r = await model.structure('# OCR markdown', { baseUrl: 'http://x:11434', model: 'glm-ocr' });

    expect(r.vendorName).toBe('Globex');
    expect(r.totalAmount).toBe(100); // normalized string -> number
    expect(r.lineItems[0]).toMatchObject({ lineNumber: 1, description: 'Item A', amount: 20 });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.format).toBe('json');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/structuring/ollama.test.ts`
Expected: FAIL — cannot find module `../../src/structuring/ollama.js`.

- [ ] **Step 3: Write the implementation**

Create `api/src/structuring/ollama.ts`:

```ts
import type { StructuringModel } from './types.js';
import { STRUCTURING_PROMPT } from './types.js';
import { normalizeStructured } from './index.js';
import { ollamaChat } from '../lib/ollama.js';

const DEFAULT_BASE_URL = 'http://host.docker.internal:11434';

// Local structuring via Ollama. Reuses the shared STRUCTURING_PROMPT and normalizer.
// Prefers the model from the saved Ollama credentials, falling back to the configured
// structuring_model setting passed in by the factory.
export const ollamaStructModel = (model: string): StructuringModel => ({
  provider: 'ollama',
  model,
  async structure(markdown, creds) {
    const baseUrl = creds.baseUrl || DEFAULT_BASE_URL;
    const useModel = creds.model || model;
    const text = await ollamaChat(
      baseUrl,
      useModel,
      `${STRUCTURING_PROMPT}\n\nOCR markdown:\n${markdown}`,
      { json: true },
    );
    return normalizeStructured(text);
  },
});
```

- [ ] **Step 4: Register the backend in the impl map**

In `api/src/structuring/index.ts`, add the import alongside the existing structuring imports (after the `mistralStructModel` import, ~line 6):

```ts
import { ollamaStructModel } from './ollama.js';
```

Then add `ollama` to the `impl` record inside `getStructuringModel` (the object currently `{ anthropic: anthropicModel, openai: openaiModel, mistral: mistralStructModel }`):

```ts
  const impl: Record<string, (m: string) => StructuringModel> = {
    anthropic: anthropicModel, openai: openaiModel, mistral: mistralStructModel,
    ollama: ollamaStructModel,
  };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/structuring/ollama.test.ts`
Expected: PASS (1 test).
Run: `npx tsc --noEmit`
Expected: exit 0 (no type errors).

- [ ] **Step 6: Commit**

```bash
git add api/src/structuring/ollama.ts api/src/structuring/index.ts api/tests/structuring/ollama.test.ts
git commit -m "feat(structuring): add local Ollama structuring backend"
```

---

## Task 4: Ollama OCR extraction provider

**Files:**
- Create: `api/src/providers/ollama.ts`
- Modify: `api/src/providers/registry.ts` (import + REGISTRY array)
- Modify: `api/src/providers/reference.ts` (add `ollama` cost row)
- Test: `api/tests/providers/ollama.test.ts`

- [ ] **Step 1: Write the failing test**

Create `api/tests/providers/ollama.test.ts`. It mocks the rasterizer and the structuring lookup so the provider can be tested in isolation:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../src/lib/rasterize.js', () => ({
  rasterizePdf: vi.fn(async () => ['PAGE1B64']),
}));
vi.mock('../../src/structuring/index.js', () => ({
  getStructuringModel: vi.fn(async () => ({
    model: { provider: 'ollama', model: 'glm-ocr', structure: vi.fn(async (md: string) => ({
      vendorName: 'Acme', lineItems: [], confidence: 0.5,
    })) },
    creds: { baseUrl: 'http://x:11434', model: 'glm-ocr' },
  })),
}));

import { ollamaProvider } from '../../src/providers/ollama.js';
import { rasterizePdf } from '../../src/lib/rasterize.js';

afterEach(() => vi.clearAllMocks());

describe('ollamaProvider', () => {
  it('is markdown-kind and configured only with baseUrl + model', () => {
    expect(ollamaProvider.kind).toBe('markdown');
    expect(ollamaProvider.isConfigured({ baseUrl: 'http://x', model: 'glm-ocr' })).toBe(true);
    expect(ollamaProvider.isConfigured({ baseUrl: 'http://x' })).toBe(false);
    expect(ollamaProvider.isConfigured(null)).toBe(false);
  });

  it('rasterizes, OCRs the images, then structures the markdown', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ message: { content: '# OCR MD' } }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const r = await ollamaProvider.extract(
      Buffer.from('%PDF-fake'),
      { baseUrl: 'http://host.docker.internal:11434', model: 'glm-ocr' },
      { fileName: 'a.pdf', structuring: null },
    );

    expect(rasterizePdf).toHaveBeenCalledOnce();
    // OCR call carries the page images
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body.messages[0].images).toEqual(['PAGE1B64']);
    expect(r.rawText).toBe('# OCR MD');
    expect(r.vendorName).toBe('Acme'); // came from the structuring step
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/providers/ollama.test.ts`
Expected: FAIL — cannot find module `../../src/providers/ollama.js`.

- [ ] **Step 3: Write the implementation**

Create `api/src/providers/ollama.ts`:

```ts
import type { ExtractionProvider, CanonicalResult } from './types.js';
import { getStructuringModel } from '../structuring/index.js';
import { rasterizePdf } from '../lib/rasterize.js';
import { ollamaChat } from '../lib/ollama.js';

const OCR_PROMPT =
  'You are an OCR engine. Transcribe this invoice image to clean GitHub-flavored Markdown. ' +
  'Preserve every line-item table row, number, date, and label exactly as printed. ' +
  'Output only the transcription — no commentary, no code fences.';

export const ollamaProvider: ExtractionProvider = {
  name: 'ollama',
  displayName: 'GLM-OCR (Ollama)',
  kind: 'markdown',
  requiredCredentials: ['baseUrl', 'model'],
  isConfigured: (c) => !!c?.baseUrl && !!c?.model,
  async extract(file, creds) {
    const images = await rasterizePdf(file);
    const markdown = await ollamaChat(creds.baseUrl, creds.model, OCR_PROMPT, { images });
    const { model, creds: sCreds } = await getStructuringModel();
    const fields = await model.structure(markdown, sCreds);
    const out: CanonicalResult = { ...fields, rawText: markdown, rawJson: { markdown } };
    return out;
  },
};
```

- [ ] **Step 4: Register the provider**

In `api/src/providers/registry.ts`, add the import after the existing provider imports (~line 6):

```ts
import { ollamaProvider } from './ollama.js';
```

Add `ollamaProvider` to the `REGISTRY` array:

```ts
const REGISTRY: ExtractionProvider[] = [mistralProvider, azureProvider, llamaparseProvider, textractProvider, googleProvider, ollamaProvider];
```

- [ ] **Step 5: Add the (free) cost reference row**

In `api/src/providers/reference.ts`, add an `ollama` entry to `PROVIDER_REFERENCE` (so `estimateCost('ollama')` returns 0 instead of undefined):

```ts
  ollama:     { costPer1k: 0,   headerAcc: 0.85, lineAcc: 0.8,  pattern: 'local OCR→md + LLM' },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/providers/ollama.test.ts`
Expected: PASS (2 tests).
Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add api/src/providers/ollama.ts api/src/providers/registry.ts api/src/providers/reference.ts api/tests/providers/ollama.test.ts
git commit -m "feat(ocr): add GLM-OCR (Ollama) extraction provider"
```

---

## Task 5: Web Settings wiring

**Files:**
- Modify: `web/src/pages/SettingsPage.tsx`

The Ollama extraction provider already auto-renders its `baseUrl`/`model` fields in the
"Provider credentials" section (that section maps `settings.providers`, which now includes
Ollama). This task only adds Ollama as a **structuring** option (no API key) and pre-fills
sensible defaults. **All commands in this task run from `web/`.**

- [ ] **Step 1: Add Ollama to the structuring provider list (keyless)**

In `web/src/pages/SettingsPage.tsx`, replace the `STRUCTURING_PROVIDERS` constant (lines 7-11) with:

```tsx
const STRUCTURING_PROVIDERS: { name: string; label: string; keyless?: boolean }[] = [
  { name: 'anthropic', label: 'Anthropic' },
  { name: 'openai', label: 'OpenAI' },
  { name: 'mistral', label: 'Mistral' },
  { name: 'ollama', label: 'GLM-OCR (Ollama)', keyless: true },
];
```

- [ ] **Step 2: Skip the API-key card for keyless structuring providers**

In the same file, the "Structuring provider credentials" section maps `STRUCTURING_PROVIDERS`
(starts ~line 350: `{STRUCTURING_PROVIDERS.map((sp) => {`). Change it to filter out keyless
providers:

```tsx
      {STRUCTURING_PROVIDERS.filter((sp) => !sp.keyless).map((sp) => {
```

(Ollama reuses the `ollama` provider's `baseUrl`/`model` from Section 2, so it needs no key card.)

- [ ] **Step 3: Pre-fill default Ollama baseUrl/model in the credential fields**

In the `load` callback, after the `for (const p of data.providers)` loop that builds `cv`
(immediately after the line `if (c) for (const f of p.requiredCredentials ?? []) ...`, around
line 131), add defaults so the fields are populated the first time:

```tsx
      if (cv['ollama.baseUrl'] == null || cv['ollama.baseUrl'] === '') cv['ollama.baseUrl'] = 'http://host.docker.internal:11434';
      if (cv['ollama.model'] == null || cv['ollama.model'] === '') cv['ollama.model'] = 'glm-ocr';
```

- [ ] **Step 4: Typecheck / build the web app**

Run (from `web/`): `npm run build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/SettingsPage.tsx
git commit -m "feat(web): expose GLM-OCR (Ollama) as a local structuring option"
```

---

## Task 6: Docker — install poppler-utils, rebuild, verify end-to-end

**Files:**
- Modify: `api/Dockerfile`

- [ ] **Step 1: Add poppler-utils to both stages**

In `api/Dockerfile`, both the build stage and the runtime stage have the line:

```dockerfile
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
```

Change **both** occurrences to include `poppler-utils`:

```dockerfile
RUN apt-get update -y && apt-get install -y openssl poppler-utils && rm -rf /var/lib/apt/lists/*
```

- [ ] **Step 2: Run the full API test suite**

Run (from `api/`): `npx vitest run`
Expected: all suites PASS (existing 46 + new Ollama/rasterize tests).

- [ ] **Step 3: Rebuild and restart the stack**

Run (from repo root): `docker compose up -d --build api web`
Expected: images build (poppler installs), containers come up.

- [ ] **Step 4: Verify pdftoppm is present in the API container**

Run: `docker compose exec -T api pdftoppm -h`
Expected: prints pdftoppm usage (exit non-zero is fine; it must NOT be "not found").

- [ ] **Step 5: Manual end-to-end verification**

1. Open the web app at http://localhost:8080 → Settings.
2. Under **Provider credentials → GLM-OCR (Ollama)**, confirm `baseUrl` = `http://host.docker.internal:11434` and `model` = `glm-ocr`, click **Save**. The badge should flip to **Configured**.
3. Under **Selections**, set **Active extraction provider** = `GLM-OCR (Ollama) (ollama)`, **Structuring model provider** = `GLM-OCR (Ollama)`, **Structuring model** = `glm-ocr`, click **Save selections**.
4. On an invoice, click **Re-extract**. Confirm it reaches **COMPLETED** with fields populated.
5. If it fails, read the invoice error — it will name the failing step (rasterize / Ollama unreachable / HTTP status), per Task 1/2 error messages.

- [ ] **Step 6: Commit**

```bash
git add api/Dockerfile
git commit -m "build(api): install poppler-utils for PDF rasterization"
```

---

## Self-review notes

- **Spec coverage:** rasterizer (T1), shared Ollama client (T2), structuring backend + registry (T3), extraction provider + registry + cost (T4), Settings UI incl. keyless structuring + defaults (T5), Dockerfile poppler + e2e verify (T6). The spec's `config.ts requiredCredentials` item is **not needed** — verified the Settings UI consumes `/api/settings`, which already returns `requiredCredentials`; noted here so it isn't treated as a gap.
- **Type consistency:** `ollamaChat(baseUrl, model, prompt, opts)`, `rasterizePdf(buf, opts)`, `ollamaStructModel(model): StructuringModel`, and `ollamaProvider: ExtractionProvider` are used identically across tasks. `creds.baseUrl`/`creds.model` are the only credential keys, matching `requiredCredentials: ['baseUrl','model']`.
- **No placeholders:** every code step shows complete content.
