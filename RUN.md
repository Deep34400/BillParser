# Run locally (frontend + new platform backend)

## What you use now

| Part | Folder | Tech |
|------|--------|------|
| Backend | `platform/` | Fastify + Firestore (LOCAL_DEV in-memory for local) |
| Frontend | `web/` | React + Vite |

Old `api/` (PostgreSQL) is removed.

---

## Quick start (2 terminals)

### Terminal 1 — Backend
```bash
cd platform
npm install
npm run dev
```
→ http://localhost:4000

### Terminal 2 — Frontend
```bash
cd web
npm install
npm run dev
```
→ http://localhost:5173

Open **http://localhost:5173** in browser. Vite proxies `/api/*` to backend on port 4000.

---

## Local dev mode (no GCP keys)

`platform/.env` has:
```
LOCAL_DEV=true
MISTRAL_API_KEY=...   # OCR + normalization (default)
GEMINI_API_KEY=...    # only if NORMALIZE_PROVIDER=gemini
GEMINI_MODEL=gemini-2.5-flash
MISTRAL_MODEL=mistral-small-latest
NORMALIZE_PROVIDER=mistral   # mistral | gemini
```

- **Mistral OCR** = reads PDF → markdown (`providers/mistralOcr.ts`)
- **Normalization** = markdown → parsed invoice JSON
  - Default: **Mistral** (`providers/mistralNormalize.ts`) — uses same `MISTRAL_API_KEY`
  - Optional: **Gemini** (`providers/geminiNormalize.ts`) — needs valid `GEMINI_API_KEY` with billing credits
- `LOCAL_DEV=true` uses in-memory storage (no Firestore needed locally)
- PDF preview: backend serves files at `GET /api/invoices/:id/file` (stored in memory locally)

For production: set `LOCAL_DEV=false` + GCP service account.

---

## Switch OCR / normalization provider

### Option A — Environment variable (recommended for local)

Edit `platform/.env`:

```bash
# Use Mistral for both OCR + JSON structuring (default, one API key)
NORMALIZE_PROVIDER=mistral
MISTRAL_API_KEY=your-key
MISTRAL_MODEL=mistral-small-latest

# OR use Gemini for structuring (needs paid Gemini credits)
NORMALIZE_PROVIDER=gemini
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-2.5-flash
MISTRAL_API_KEY=your-key   # still used for OCR step
```

Restart backend after changing `.env`:
```bash
cd platform && npm run dev
```

**Where it is wired in code:**
| Step | File | Env |
|------|------|-----|
| OCR (PDF → markdown) | `platform/src/providers/mistralOcr.ts` | `MISTRAL_API_KEY` |
| Normalize (markdown → JSON) | `platform/src/providers/mistralNormalize.ts` or `geminiNormalize.ts` | `NORMALIZE_PROVIDER` |
| Provider picker | `platform/src/routes/bills.ts` → `pickNormalize()` | reads env at startup |

### Option B — Settings UI (stored in Firestore / dev memory)

Open http://localhost:5173/settings

1. **Active extraction provider** — OCR provider (Mistral, Azure, Document AI, etc.)
2. **Structuring model provider** — Gemini, etc.
3. Save API keys per provider

Note: upload pipeline currently calls Mistral OCR + `pickNormalize()` from env. Settings UI credentials are used by `/api/config` and future provider registry work.

---

## Account System & Authentication

The platform supports multi-tenant access with email/password login and prepaid balances.

### First startup — Admin account

On first boot, an admin account is created automatically:

| Setting | Default | Env variable |
|---------|---------|-------------|
| Email | `admin@praya.io` | `ADMIN_EMAIL` |
| Password | `admin123` | `ADMIN_PASSWORD` |
| JWT Secret | `dev-secret-...` | `JWT_SECRET` |

Change these in `platform/.env` before production.

### Authentication methods

| Method | When to use | Header |
|--------|-------------|--------|
| **Email + Password** | Web UI login (returns JWT session token) | JWT stored in browser |
| **API Key** | Programmatic access (scripts, integrations) | `Authorization: Bearer inv_xxxx...` |

In LOCAL_DEV mode, unauthenticated requests are allowed (no auth header needed).

### Roles

| Role | Capabilities |
|------|-------------|
| **admin** | Manage users, add balance, block/unblock, unlimited OCR |
| **user** | Upload invoices (actual OCR cost deducted), view own data |

### Login flow

1. Open http://localhost:5173 → Login page appears
2. Enter email + password → Get JWT session (stored in browser, valid 7 days)
3. Sidebar shows your balance, OCR count, and cost
4. Admin users see an "Admin" nav link

### Balance & cost deduction

- Each OCR deducts **actual API cost** (Mistral OCR + normalization) from balance
- Typical cost: $0.002–$0.01 per invoice depending on page count
- If balance ≤ 0, upload returns **HTTP 402** (Insufficient balance)
- Admin accounts have unlimited balance

### API Key management

After login, users can generate API keys for programmatic access:

```bash
# Generate an API key (via UI or API)
curl -X POST -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"CI Pipeline"}' \
  http://localhost:4000/api/auth/api-keys

# List your API keys
curl -H "Authorization: Bearer $JWT_TOKEN" \
  http://localhost:4000/api/auth/api-keys

# Revoke an API key
curl -X DELETE -H "Authorization: Bearer $JWT_TOKEN" \
  http://localhost:4000/api/auth/api-keys/<key_id>
```

### Admin operations (API)

```bash
# Login as admin
curl -X POST -H "Content-Type: application/json" \
  -d '{"email":"admin@praya.io","password":"admin123"}' \
  http://localhost:4000/api/auth/login
# → Returns JWT token + user info

# Create a user (with password + initial balance)
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","name":"Test User","password":"secure123","initial_balance":5}' \
  http://localhost:4000/api/admin/users

# Add balance ($5) to a user
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"amount":5,"description":"Monthly top-up"}' \
  http://localhost:4000/api/admin/users/<user_id>/tokens

# Block / Unblock a user
curl -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:4000/api/admin/users/<user_id>/block

# Reset a user's password
curl -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"password":"newpass123"}' \
  http://localhost:4000/api/admin/users/<user_id>/reset-password
```

### Admin UI

Navigate to **/admin** in the web app (visible only for admin role):
- Create new users with email + password + initial balance
- View all users with balance, OCR count, cost
- Add balance to any user
- Block/unblock users
- Reset user passwords

---

## OCR Cost Tracking

Every invoice now tracks actual API costs:

| Field | Source |
|-------|--------|
| `extractionCost` | Mistral OCR API token usage |
| `structuringCost` | Mistral/Gemini structuring token usage |
| `totalCost` | Sum of extraction + structuring |
| Token counts | `prompt_tokens + completion_tokens` |
| Latency | Milliseconds per step |

**Per-invoice**: visible on the Invoice Detail page (extraction cost · tokens · model).

**Aggregated**: visible on the Analytics page → "OCR API Cost Analytics" card showing:
- Total cost (INR + USD)
- Breakdown by provider (Mistral vs Gemini)
- Average cost per OCR
- Total tokens consumed

### Pricing (approximate, update in code)

| Provider | Input/1K tokens | Output/1K tokens | File |
|----------|----------------|-------------------|------|
| Mistral OCR | $0.001 | $0.001 | `providers/mistralOcr.ts` |
| Mistral Small | $0.001 | $0.003 | `providers/mistralNormalize.ts` |
| Gemini 2.5 Flash | $0.00015 | $0.0006 | `providers/geminiNormalize.ts` |

---

## Docker (production-style)

```bash
docker compose up --build
```
→ Web: http://localhost:8081  
→ API: http://localhost:4000

---

## Health check

```bash
curl http://localhost:4000/api/health
curl http://localhost:4000/api/config
curl http://localhost:4000/api/invoices
```

---

## Tests

```bash
cd platform && npm test
cd web && npm test
```
