# Audit History

Every important user action writes one append-only row to `audit_logs`. The UI reads that table — it is not inferred from invoices.

## How it works

```
Invoice upload / OCR / approve / admin action
        │
        ▼
ocr/service/recordActivity.ts  (invoice lifecycle)
  or audit() directly           (admin, webhook CRUD)
        │
        ▼
audit(action, { userId, resourceType, resourceId, details })
        │  fire-and-forget (never blocks OCR)
        ▼
audit_logs  ── GET /api/audit/logs ──► Account → My activity
                                      Admin  → Activity tab
```

`recordActivity()` in `ocr/service/recordActivity.ts` is the shared helper for invoice events — it writes audit rows and optionally dispatches webhooks in one call.

`audit()` is fire-and-forget. A failed insert is logged to the console and does not fail the original request.

## Where you see it

| Who | Screen | What they see |
|-----|--------|----------------|
| Any signed-in user | **Account → My activity** | Only their own rows |
| Admin | **Admin → Activity** | All users (optional action filter) |

Regular users cannot pass another `userId` on `GET /api/audit/logs`. Admins can.

## What gets written

| Action | When |
|--------|------|
| `invoice:upload` | File, URL import, or API OCR creates a bill |
| `invoice:complete` | Background OCR finishes (`OCR_COMPLETED` or `NEED_REVIEW`) |
| `invoice:fail` | OCR fails, or the user cancels processing |
| `invoice:edit` | Human correction (`PATCH /api/invoices/:id`) |
| `invoice:reextract` | Re-run OCR |
| `invoice:submit_approval` | Submit for approval |
| `invoice:approve` / `invoice:reject` | Approval decision |
| `invoice:delete` / `invoice:bulk_delete` | Single or bulk delete |
| `invoice:cancel` | Cancel while processing |
| `user:create` / `user:block` / `user:unblock` / `user:reset_password` | Admin user actions |
| `tokens:credit` | Admin adds balance |
| `webhook:create` / `webhook:update` / `webhook:delete` | Webhook endpoint changes |

Token **debits** for OCR live in `token_transactions` (Account → Usage History), not as `tokens:debit` audit rows.

## API

```
GET /api/audit/logs?action=invoice:approve&limit=50&offset=0
Authorization: Bearer <JWT>
```

Admin-only query: `userId=...`

Response:

```json
{
  "success": true,
  "data": [
    {
      "log_id": "...",
      "user_id": "...",
      "action": "invoice:approve",
      "resource_type": "bill",
      "resource_id": "...",
      "details": {},
      "ip_address": null,
      "created_at": "2026-09-13T08:00:00.000Z"
    }
  ],
  "metadata": { "total": 1 }
}
```

## Table

See [DATABASE.md](../../DATABASE.md) — `audit_logs`.
