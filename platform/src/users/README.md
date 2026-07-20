# Users Module

Authentication, authorization, user management, and token-based billing. Follows the controller → service → repository pattern.

## How It Works — Full Flow

### Login Flow

```
User submits email + password on the login page
  → Frontend calls POST /api/auth/login
  → route.ts validates that email and password are present
  → service.ts → login() is called:
    1. Looks up the user by email in Firestore (repository.ts → getUserByEmail)
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
    - Look up user from Firestore
    - Attach user to req.appUser
  → If token starts with "inv_" → it's an API key:
    - SHA-256 hash the key
    - Look up the matching api_keys document
    - Find the user who owns that key
    - Attach user to req.appUser
  → If neither → 401 Unauthorized (unless LOCAL_DEV mode or public path)
```

### API Key Management

```
User clicks "Generate API Key" in the Account page
  → POST /api/auth/api-keys
  → service.ts → issueApiKey():
    1. Generates a random 32-byte key prefixed with "inv_"
    2. SHA-256 hashes it for storage
    3. Saves the full key, hash, and prefix to Firestore api_keys collection
    4. Returns the full key to the user (they can copy it from the UI anytime)
  → User can authenticate with: Authorization: Bearer inv_xxxx...

User clicks "Revoke" on an API key
  → DELETE /api/auth/api-keys/:keyId
  → service.ts → revokeApiKey():
    1. Lists the user's keys to verify ownership
    2. Deletes the key document from Firestore
    3. The key immediately stops working
```

### Token Billing (How OCR Costs Are Charged)

```
OCR pipeline completes successfully
  → ocr/route.ts calculates the USD cost from token usage
  → Calls users/service.ts → deductTokens():
    1. Looks up the user
    2. Checks token_balance >= amount (throws if insufficient)
    3. Subtracts from token_balance
    4. Increments total_tokens_used and total_ocr_count
    5. Creates a TokenTransactionDoc (debit) for audit trail
  → Calls users/service.ts → trackOcrCost():
    1. Adds the USD cost to the user's lifetime total_cost_usd

Admin tops up a user's balance
  → POST /api/admin/users/:id/tokens
  → service.ts → addTokens():
    1. Adds to token_balance
    2. Creates a TokenTransactionDoc (credit) for audit trail
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
    4. Creates UserDoc in Firestore with initial balance
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
│  - Never accesses Firestore directly            │
├─────────────────────────────────────────────────┤
│  service.ts (Service)                           │
│  - Business logic and domain rules              │
│  - login(), issueApiKey(), deductTokens(), etc. │
│  - Validation (password length, balance check)  │
│  - Orchestrates repository calls                │
│  - No HTTP or Fastify concerns                  │
├─────────────────────────────────────────────────┤
│  repository.ts (Repository)                     │
│  - Pure Firestore CRUD operations               │
│  - createUser, getUser, updateUser, listUsers   │
│  - Password hashing (scrypt)                    │
│  - API key hashing (SHA-256)                    │
│  - Works with devStore in LOCAL_DEV mode        │
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
- You can swap Firestore for another DB by only changing repository.ts
- Route handlers stay thin and predictable

## File Reference

| File | Layer | What it does |
|------|-------|-------------|
| `route.ts` | Controller | All HTTP endpoints (auth + account + admin) |
| `service.ts` | Service | login, issueApiKey, revokeApiKey, registerUser, blockUser, deductTokens, addTokens, trackOcrCost |
| `repository.ts` | Repository | Firestore CRUD for users, api_keys, token_transactions collections |
| `dto.ts` | DTO | clientUserView (hide sensitive data), sanitizeUser (admin view) |

## Security

- **Passwords**: scrypt with random 16-byte salt (no external dependency)
- **API keys**: `inv_` + 32 random bytes, stored as SHA-256 hash
- **JWT**: 7-day expiry, signed with `JWT_SECRET` env var
- **Admin routes**: `requireAdmin` preHandler rejects non-admin users
- **Blocked users**: checked on every login and JWT verification
