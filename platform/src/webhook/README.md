# Webhooks

Each user can register HTTPS endpoints. When that user uploads, finishes, fails, approves, rejects, or deletes an invoice, the platform POSTs a signed JSON body to every **active** endpoint subscribed to that event.

## How it works

```
You add a URL on Account → Webhooks
        │
        ▼
webhook_endpoints  (url, events[], secret, active, user_id)
        │
Invoice lifecycle (ocrLifecycle / invoiceService / ocrWorker)
        │
        ▼
recordActivity() → dispatchWebhookEvent(userId, 'invoice.completed', { billId, ... })
        │
        ▼
For each matching active endpoint:
  Attempt 1 (immediate) → Attempt 2 (+10s) → Attempt 3 (+30s)
  POST url
  Content-Type: application/json
  X-Webhook-Event: invoice.completed
  X-Webhook-Signature: sha256=<hmac>
        │
        ▼
webhook_deliveries  (one row per attempt)
```

Delivery is fire-and-forget from the caller's perspective: a down receiver is logged and retried, but never rolls back OCR or approval.

## Retry policy

| Attempt | Delay | Notes |
|---------|-------|-------|
| 1 | 0s | Immediate |
| 2 | 10s | After first failure |
| 3 | 30s | After second failure |

Each attempt is logged in `webhook_deliveries` with `status_code`, `response_body` (truncated to 4096 chars), `success`, and `error`.

View delivery history: **Account → Webhooks** or `GET /api/webhooks/:id/deliveries?limit=50`.

## Where you see it

**Account → Webhooks** — create, pause, and delete your own endpoints.

The signing secret is shown **once** after create. Copy it; the list view does not highlight it again for safety, but the API still stores it for HMAC.

## Events

| Event | Fired when |
|-------|------------|
| `invoice.uploaded` | Bill created (UI upload, URL import, sync/async API OCR) |
| `invoice.completed` | OCR finished successfully |
| `invoice.failed` | OCR failed or the user cancelled |
| `invoice.approved` | Invoice approved |
| `invoice.rejected` | Invoice rejected |
| `invoice.deleted` | Invoice deleted (single or bulk) |

Submit-for-approval does **not** send a webhook (it is audit-only).

## Payload

```json
{
  "id": "delivery-uuid",
  "event": "invoice.completed",
  "timestamp": "2026-09-13T08:00:00.000Z",
  "data": {
    "billId": "bill-uuid",
    "fileName": "workshop.pdf",
    "status": "OCR_COMPLETED",
    "costUsd": 0.0123
  }
}
```

`data` always includes `billId`. Extra fields depend on the event (`fileName`, `status`, `error`, `reason`, …).

## Verify the signature

```
X-Webhook-Signature: sha256=<hex>
```

HMAC-SHA256 of the **raw request body** using the endpoint secret (`whsec_...`).

```js
import { createHmac, timingSafeEqual } from 'crypto';

function verify(rawBody, header, secret) {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
```

Use the raw bytes, not a re-serialized JSON object.

## URL rules

- Remote URLs must start with `https://`
- `http://localhost` and `http://127.0.0.1` are allowed for a local receiver
- Timeout: 10 seconds per attempt; non-2xx responses trigger retry (up to 3 attempts total)

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/webhooks` | List your endpoints + `availableEvents` |
| `POST` | `/api/webhooks` | `{ url, events, description? }` — returns `secret` (Zod-validated) |
| `PATCH` | `/api/webhooks/:id/toggle` | `{ active: true \| false }` |
| `DELETE` | `/api/webhooks/:id` | Remove endpoint |
| `GET` | `/api/webhooks/:id/deliveries` | Recent delivery attempts (`?limit=50`, max 200) |

You can only toggle, delete, or view deliveries for **your** endpoints.

## Tables

See [DATABASE.md](../../DATABASE.md):
- `webhook_endpoints` — subscription config
- `webhook_deliveries` — per-attempt delivery log
