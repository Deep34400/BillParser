# Users Module

Authentication, authorization, user management, and token-based billing. Follows the controller → service → repository pattern. Data lives in PostgreSQL; Sequelize models are defined in `users/models/`.

> **Multi-tenancy note:** Users belong to organizations via the `org_members` table (managed by the [tenant module](../tenant/README.md)). After authentication, the `tenantContext` middleware resolves `req.orgId` and `req.orgRole` from the user's org membership. RBAC permissions are defined in `shared/roles.ts`.

## Directory Structure

```
users/
├── models/
│   ├── user.ts              # User Sequelize model
│   ├── apiKey.ts            # ApiKey Sequelize model
│   ├── tokenTransaction.ts  # TokenTransaction Sequelize model
│   └── index.ts             # Barrel
├── repository.ts            # PostgreSQL CRUD (Sequelize)
├── service.ts               # Business logic
├── dto.ts                   # Data transfer objects
├── route.ts                 # HTTP endpoints
└── README.md
```

Enum values (`USER_ROLES`, `USER_STATUSES`, `TX_TYPES`) are defined in `shared/constants.ts` and validated on the Sequelize models.

## How It Works — Full Flow

### Login Flow

```
User submits email + password on the login page
  → Frontend calls POST /api/auth/login
  → route.ts validates that email and password are present
  → service.ts → login() is called:
    1. Looks up the user by email in PostgreSQL (repository.ts → getUserByEmail)
    2. Verifies password against stored scrypt hash (repository.ts → verifyPassword)
    3. Checks user status is not 'blocked'
    4. Returns the user object (or an error with HTTP status code)
  → route.ts signs a JWT with { user_id, role } using Fastify JWT plugin
  → Returns { token, user } to the frontend
  → Frontend stores the JWT in localStorage and sends it as Bearer token on all requests
```

### Request Authentication (every API call)

```
Any API request arrives at the server
  → middleware/auth.ts runs as an onRequest hook (before any route handler)
  → Extracts the Bearer token from the Authorization header
    (or from ?token= query param for invoice file previews — iframe can't send headers)
  → If token starts with "eyJ" → it's a JWT:
    - Verify signature with JWT_SECRET
    - Decode { user_id, role }
    - Look up user from PostgreSQL
    - Attach user to req.appUser
  → If token starts with "inv_" → it's an API key:
    - SHA-256 hash the key
    - Look up the matching api_keys row via Sequelize
    - Find the user who owns that key
    - Attach user to req.appUser
  → If neither → 401 Unauthorized (unless a public path)
```

### API Key Management

```
User clicks "Generate API Key" in the Account page
  → POST /api/auth/api-keys
  → service.ts → issueApiKey():
    1. Generates a random 32-byte key prefixed with "inv_"
    2. SHA-256 hashes it for storage
    3. Saves the hash and prefix to the PostgreSQL api_keys table (ApiKey model)
    4. Returns the full key to the user (shown once in the UI)
  → User can authenticate with: Authorization: Bearer inv_xxxx...

User clicks "Revoke" on an API key
  → DELETE /api/auth/api-keys/:keyId
  → service.ts → revokeApiKey():
    1. Lists the user's keys to verify ownership
    2. Deletes the key row from PostgreSQL
    3. The key immediately stops working
```

### Token Billing (How OCR Costs Are Charged)

```
OCR pipeline completes successfully
  → ocr/route.ts calculates the USD cost from token usage
  → Calls users/service.ts → deductTokens():
    1. Calls repository.ts → applyTokenTransaction() (type: debit)
    2. Inside a sequelize().transaction():
       - UPDATE users SET token_balance = token_balance - amount
         WHERE user_id = ? AND token_balance >= amount  (atomic — no race)
       - Increments total_tokens_used and total_ocr_count on debit
       - Inserts a TokenTransaction row for audit trail
    3. Throws if insufficient balance (affected row count = 0)
  → Calls users/service.ts → trackOcrCost():
    1. Adds the USD cost to the user's lifetime total_cost_usd

Admin tops up a user's balance
  → POST /api/admin/users/:id/tokens
  → service.ts → addTokens():
    1. Calls applyTokenTransaction() (type: credit)
    2. Creates a TokenTransaction row (credit) for audit trail
```

### User Administration (Admin Only)

```
Admin creates a new user
  → POST /api/admin/users { email, name, password, role, initial_balance }
  → route.ts validates required fields
  → service.ts → registerUser():
    1. Validates password length >= 6
    2. Checks for duplicate email
    3. Hashes password with scrypt + random salt
    4. Creates User row in PostgreSQL with initial balance
  → Returns the sanitized user (no password_hash in response)
```

## Architecture — Layered Design

```
┌─────────────────────────────────────────────────┐
│  route.ts (Controller)                          │
│  - HTTP request/response handling               │
│  - Input validation (required fields, types)    │
│  - Calls service functions                      │
│  - Formats JSON response                        │
│  - Never accesses the database directly         │
├─────────────────────────────────────────────────┤
│  service.ts (Service)                           │
│  - Business logic and domain rules              │
│  - login(), issueApiKey(), deductTokens(), etc. │
│  - Validation (password length, balance check)  │
│  - Orchestrates repository calls                │
│  - No HTTP or Fastify concerns                  │
├─────────────────────────────────────────────────┤
│  repository.ts (Repository)                   │
│  - Sequelize CRUD for users, api_keys,          │
│    token_transactions tables                    │
│  - createUser, getUser, updateUser, listUsers   │
│  - Password hashing (scrypt + random salt)      │
│  - API key hashing (SHA-256)                    │
│  - Atomic balance ops (applyTokenTransaction)   │
├─────────────────────────────────────────────────┤
│  models/ (Sequelize)                            │
│  - User, ApiKey, TokenTransaction definitions   │
│  - Column mappings + enum validation            │
│  - Initialized via init*Model() at boot         │
├─────────────────────────────────────────────────┤
│  dto.ts (Data Transfer Objects)                 │
│  - clientUserView() → safe shape for logged-in  │
│    user (hides password, shows balance)         │
│  - sanitizeUser() → admin view (everything      │
│    except password_hash and api_key_hash)       │
└─────────────────────────────────────────────────┘
```

**Why this pattern:** Route.ts never imports from repository.ts directly. Service.ts is the single entry point for all business logic. This means:
- You can unit test service.ts without HTTP
- You can swap PostgreSQL access by only changing repository.ts and models/
- Route handlers stay thin and predictable

## File Reference

| File | Layer | What it does |
|------|-------|-------------|
| `route.ts` | Controller | All HTTP endpoints (auth + account + admin) |
| `service.ts` | Service | login, issueApiKey, revokeApiKey, registerUser, blockUser, deductTokens, addTokens, trackOcrCost |
| `repository.ts` | Repository | Sequelize CRUD for `users`, `api_keys`, `token_transactions` tables |
| `models/user.ts` | Model | User Sequelize model — maps to `users` table |
| `models/apiKey.ts` | Model | ApiKey Sequelize model — maps to `api_keys` table |
| `models/tokenTransaction.ts` | Model | TokenTransaction Sequelize model — maps to `token_transactions` table; validates `type` against `TX_TYPES` from `shared/constants.ts` |
| `models/index.ts` | Model | Barrel export for all user models |
| `dto.ts` | DTO | clientUserView (hide sensitive data), sanitizeUser (admin view) |

## PostgreSQL Tables

| Table | Model | Description |
|-------|-------|-------------|
| `users` | `User` | Accounts, password hash, token balance, role/status |
| `api_keys` | `ApiKey` | SHA-256 hashed API keys with `inv_` prefix |
| `token_transactions` | `TokenTransaction` | Credit/debit ledger (`TX_TYPES` in `shared/constants.ts`) |

## Security

- **Passwords**: scrypt with random 16-byte salt (no external dependency)
- **API keys**: `inv_` + 32 random bytes, stored as SHA-256 hash (plaintext never persisted)
- **JWT**: 7-day expiry, signed with `JWT_SECRET` env var
- **Admin routes**: `requireAdmin` preHandler rejects non-admin users
- **Blocked users**: checked on every login and JWT verification
- **Token debits**: atomic via `sequelize().transaction()` with `UPDATE … WHERE token_balance >= amount` — concurrent OCR runs cannot overdraw

## Organization Membership

After authentication, the `tenantContext` middleware looks up the user's `OrgMember` record:

```
Auth middleware sets req.appUser
  → tenantContext middleware runs
  → Looks up org_members WHERE user_id = req.appUser.user_id
  → If found: req.orgId + req.orgRole are set
  → If not found: req.orgId stays undefined (legacy mode)
```

Users belong to **one organization at a time**. Roles (owner, admin, reviewer, viewer, api_user) control what API endpoints they can access.

For the full RBAC permission matrix and org management API, see [tenant module](../tenant/README.md).
