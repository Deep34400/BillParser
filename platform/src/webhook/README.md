# Webhooks

Each user can register HTTPS endpoints. When that user uploads, finishes, fails, approves, rejects, or deletes an invoice, the platform POSTs a signed JSON body to every **active** endpoint subscribed to that event.

## How it works

```
You add a URL on Account → Webhooks
        │
        ▼
webhook_endpoints  (url, events[], secret, active, user_id)
        │
Invoice lifecycle in invoiceService
        │
        ▼
dispatchWebhookEvent(userId, 'invoice.completed', { billId, ... })
        │  fire-and-forget
        ▼
For each matching active endpoint:
  POST url
  Content-Type: application/json
  X-Webhook-Event: invoice.completed
  X-Webhook-Signature: sha256=<hmac>
```

Delivery is fire-and-forget: a down receiver is logged (`[webhook] ...`) and never rolls back OCR or approval.

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
- Timeout: 10 seconds; non-2xx responses are logged and not retried

## API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/webhooks` | List your endpoints + `availableEvents` |
| `POST` | `/api/webhooks` | `{ url, events, description? }` — returns `secret` |
| `PATCH` | `/api/webhooks/:id/toggle` | `{ active: true \| false }` |
| `DELETE` | `/api/webhooks/:id` | Remove endpoint |

You can only toggle or delete **your** endpoints.

## Table

See [DATABASE.md](../../DATABASE.md) — `webhook_endpoints`.
