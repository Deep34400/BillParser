# View uploaded PDF + side-by-side comparison

**Date:** 2026-06-24
**Status:** Approved

## Goal

On the invoice detail page, let the user view the original uploaded PDF and
compare it side-by-side with the parsed output. The comparison is available on
a toggle; when off, the page is unchanged.

## Background

- Invoices store the original file at `storedPath` (e.g.
  `/data/uploads/<hash>.pdf`) inside the API container, on the `uploads` volume.
- There is **no endpoint** that serves the original file today.
- nginx proxies `/api/` → `api:4000`, so a browser `<iframe src="/api/...">`
  loads same-origin.
- An existing "Compare source" overlay shows a *reconstructed* paper invoice
  (rebuilt from structured fields) next to raw OCR — it does **not** show the
  real PDF. This feature is additive and leaves that overlay untouched.

## Backend

### `GET /api/invoices/:id/file`

- Look up the invoice by `id`; 404 if not found.
- Resolve `storedPath`; if the file is missing on disk, 404 with
  `{ error: 'file not found' }`.
- Stream the file with:
  - `Content-Type: application/pdf`
  - `Content-Disposition: inline; filename="<fileName>"`
- Use `fs.createReadStream` (Fastify can return a stream from the handler).

No new dependency required.

## Frontend

### API client (`web/src/api.ts`)

Add a helper:

```ts
fileUrl: (id: string) => `/api/invoices/${id}/file`,
```

(A plain URL string — consumed by `<iframe>`/`<a>`, not the JSON helper.)

### `InvoiceDetailPage`

New state:

- `pdfOpen: boolean` — drives the split layout (default `false`).
- `comparePane: 'fields' | 'raw'` — which content the right pane shows
  (default `'fields'`).

**Action row:** add a **"View PDF"** toggle button next to Re-extract / Compare
source / Bake-off. When active it renders in a pressed/toggled style
(`T.accentSoft` background like "Edit fields"). Hidden while `editMode` is on.

**Main content layout:**

- `editMode` → unchanged full-width edit form (PDF toggle hidden).
- `pdfOpen === false` → unchanged: `FieldGrid` + `LineItemTable` full width,
  followed by the existing "Show raw OCR" section.
- `pdfOpen === true` → 2-column CSS grid (`minmax(0, 1fr) minmax(0, 1fr)`):
  - **Left — PDF pane:** sticky header strip with the label "Source PDF" and an
    "Open in new tab ↗" link (`href={api.fileUrl(id)}` target=`_blank`).
    Below it an `<iframe src={api.fileUrl(id)}>` filling the column at a tall
    fixed height (e.g. `calc(100vh - 220px)`, `minHeight: 600`).
  - **Right — parsed pane:** a segmented `[Fields | Raw OCR]` toggle bound to
    `comparePane`, then:
    - `fields` → `FieldGrid` + `LineItemTable` (reused as-is).
    - `raw` → the raw OCR `<pre>` block (same styling as the existing raw
      section) or its "No OCR text" placeholder.
  - On narrow viewports the grid collapses to a single column (PDF on top).
    Implemented with a width breakpoint (existing code uses inline styles; use a
    simple `gridTemplateColumns` that switches via a `useMediaQuery`-style
    check or a CSS `@media` injected once — prefer a minimal inline approach
    consistent with the file).

When `pdfOpen` is true, the standalone "Show raw OCR" section at the bottom is
hidden (raw OCR is reachable via the right-pane toggle) to avoid duplication.

### PDF-unavailable handling

The iframe will display the API's 404 body if the file is gone. Acceptable for
v1. Optional nicety (include if cheap): a `HEAD`/`fetch` probe on open that, on
non-200, replaces the iframe with a "PDF unavailable" message. Keep this
minimal — do not block the core feature on it.

## Edge cases

- **FAILED invoices:** the uploaded PDF still exists, so "View PDF" works. The
  Fields pane shows `—`/empty values; the Raw OCR pane shows its placeholder.
- **PENDING/PROCESSING:** PDF exists and is viewable; parsed side fills in as
  polling completes (existing polling already updates `inv`).

## Out of scope

- Per-page navigation / pdf.js rendering (browser-native PDF viewer is enough).
- Highlighting/linking fields to PDF regions.
- Changes to the existing "Compare source" or "Bake-off" overlays.

## Testing

- **API:** `GET /api/invoices/:id/file` returns 200 + `application/pdf` for an
  existing invoice with a present file; 404 for unknown id; 404 when the file is
  absent on disk. (vitest, matching existing route tests.)
- **Web:** smoke via the running app — open a detail page, toggle "View PDF",
  confirm the iframe loads the real PDF, flip `[Fields | Raw OCR]`, toggle off
  and confirm the page returns to full-width.
