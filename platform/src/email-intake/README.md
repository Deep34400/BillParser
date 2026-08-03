# Email Intake Service

Polls a Gmail/IMAP mailbox for invoice attachments and saves them as DRAFT bills.
OCR is NOT triggered automatically — admin triggers it manually from the UI.

## How it works

```
┌─────────────┐     IMAP/TLS      ┌──────────────┐
│  Gmail box  │ ◄───────────────── │ Email Poller │
│ (UNSEEN)    │                    │ (90s loop)   │
└─────────────┘                    └──────┬───────┘
                                          │
                            ┌─────────────┼─────────────┐
                            ▼             ▼             ▼
                     Whitelist?    Attachment      Dedup?
                     (DB + JSON    filter         (Message-ID
                      + user       (PDF/img,       + SHA-256)
                      emails)      10KB–15MB,
                                   not inline)
                            │             │             │
                            └─────────────┼─────────────┘
                                          ▼
                                   ingestInvoice()
                                   ├── Upload to storage
                                   └── Create bill → DRAFT
                                       (No auto-OCR)

                        ┌──────────────────────────────┐
                        │ Admin clicks "Process OCR"   │
                        │ in the invoice list (UI)     │
                        └──────────────┬───────────────┘
                                       ▼
                              DRAFT → PROCESSING → OCR_COMPLETED
```

## Setup

### 1. Create a Gmail App Password

1. Go to https://myaccount.google.com/security
2. Enable 2-Step Verification (required)
3. Go to https://myaccount.google.com/apppasswords
4. Select "Mail" + "Other (Custom name)" → name it "Invoice Bot"
5. Copy the 16-character app password (e.g. `hfqi amsf sctt gpaa`)

### 2. Configure mailbox from Admin UI (not .env)

Go to **Admin → Email Intake** and set:
- Intake mailbox email (e.g. `techcarrum@gmail.com`)
- Gmail App Password
- Poll interval (seconds)
- Enable / Disable

Host/port are fixed in code: `imap.gmail.com:993`.
**No mail settings belong in `.env`.**

### 3. Admin Panel — allowed senders

Go to **Admin Panel → Email Intake** tab:

- **Enable/Disable** the service (starts/stops polling immediately)
- **Allowed Senders by User** — assign which email each user may send invoices FROM
  - Exact emails: `vendor@example.com`
  - Domain wildcards: `@trustedfleet.in` (optional on user field)
  - No users with intake email = all senders rejected

Also set **Allowed Sender Email** when creating a user.

### 4. User-Level Intake Emails

Each user can have an `intake_email` field (set when creating/updating users in Admin).
This auto-whitelists them — no need to manually add to allowed senders.

### 5. Run

```bash
cd platform
npm run build && npm start
```

The poller starts automatically on boot if enabled in Admin → Email Intake (and mailbox credentials are saved).

## Bill Lifecycle (email)

| Status | Meaning |
|--------|---------|
| `DRAFT` | Received from email, file saved. Awaiting manual OCR trigger. |
| `PROCESSING` | Admin clicked "Process OCR" — pipeline running |
| `OCR_COMPLETED` | Extraction done |
| `FAILED` | OCR failed |

## Triggering OCR

1. Go to Invoice List → filter by "Email Draft" status
2. Click **"Process OCR"** button on any DRAFT row
3. The bill moves to PROCESSING → OCR_COMPLETED (background)

API: `POST /api/invoices/:id/process-ocr`

## Admin API

### Toggle email intake
```
PUT /api/config/email-intake
Body: { "enabled": true }
```

### Update allowed senders
```
PUT /api/config/email-intake
Body: { "allowedSenders": ["vendor@x.com", "@domain.com"] }
```

### Both at once
```
PUT /api/config/email-intake
Body: { "enabled": true, "allowedSenders": ["@company.com"] }
```

## Deduplication

- `processed.json` tracks Message-IDs and file SHA-256 hashes
- Same email won't be processed twice even if poller restarts
- Same PDF (by content hash) is skipped even from different senders

## File Storage

Attachments are uploaded to storage through the normal storage layer.
Local backup saved to `./intake/<timestamp>_<filename>`.

## Allowed Senders (3 sources merged)

1. **DB settings** (`emailIntakeAllowedSenders`) — managed from Admin UI
2. **User intake emails** — auto-whitelisted from user profiles
3. **allowed_senders.json** — static file (legacy/backup)

## How to Test (End-to-End)

1. Start the server:
   ```bash
   cd platform && npm run build && npm start
   ```

2. Enable intake from Admin → Email Intake → Enable

3. Send a test email:
   - From a whitelisted email
   - To: `techcarrum@gmail.com`
   - Attach a PDF or image (10KB–15MB)

4. Wait one poll cycle (check logs for activity)

5. In UI: Filter by "Email Draft" → click "Process OCR" on the draft

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Email intake disabled` | Enable from Admin Panel → Email Intake tab |
| `Authentication failed` | Verify app password (16 chars, spaces included) |
| `Quarantined: sender@...` | Add sender in Admin → Email Intake → Allowed Senders |
| Email not picked up | Check it's UNREAD in Gmail inbox; poller fetches UNSEEN only |
| `too large` skip | Attachment must be ≤5 MB |
| No draft after accept | Mark email unread in Gmail and re-poll, or re-send |

## Architecture

- `poller.ts` — IMAP connect/poll/disconnect cycle
- `whitelist.ts` — sender validation (DB + JSON + user emails)
- `attachmentFilter.ts` — MIME type + size validation
- `dedup.ts` — Message-ID + SHA-256 deduplication
- `ingest.ts` — upload file, create DRAFT bill (no OCR)
- OCR is triggered separately via `/api/invoices/:id/process-ocr`
