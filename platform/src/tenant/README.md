# Tenant Module — Multi-Tenancy & RBAC

Organizations, membership, role-based access control. Added in Phase 2. Follows the controller → service → repository pattern.

## Directory Structure

```
tenant/
├── models/
│   ├── organization.ts       # Organization Sequelize model
│   ├── orgMember.ts          # OrgMember Sequelize model (composite PK)
│   └── index.ts              # Barrel export + OrgRole type
├── repository.ts             # PostgreSQL CRUD (Sequelize)
├── service.ts                # Business logic (org lifecycle, RBAC enforcement)
├── route.ts                  # HTTP endpoints (controller layer)
└── README.md
```

Related files:
- `shared/roles.ts` — RBAC permission matrix (`can()`, `permissionsFor()`)
- `middleware/tenantContext.ts` — Resolves `req.orgId` + `req.orgRole` per request

## How It Works

### Tenant Context Middleware

After authentication (`authPlugin`), the `tenantPlugin` runs:

```
Every authenticated request
  → middleware/tenantContext.ts runs
  → Looks up the user's OrgMember record via getMembership(userId)
  → If found:
    - Sets req.orgId = member.org_id
    - Sets req.orgRole = member.org_role
  → If not found:
    - req.orgId and req.orgRole remain undefined
    - User still works (legacy / no-org mode)
```

This is **non-fatal** — users without an organization can still use the system. Bills uploaded without org context have `org_id = null`.

### Organization Lifecycle

```
1. User creates an org
   → POST /api/orgs { name }
   → service.createOrganization(name, userId)
   → Creates org row + OrgMember(role: 'owner')
   → Returns the org document

2. Owner invites members
   → POST /api/orgs/members { userId, role }
   → service.inviteMember(orgId, callerRole, userId, role)
   → Validates RBAC: only owner/admin can invite
   → Can't invite as 'owner' (use ownership transfer)
   → Only owner can assign 'admin' role

3. Subsequent requests
   → Tenant context middleware sets req.orgId
   → Repository queries filter bills by org_id
   → Data isolation between organizations
```

### Data Isolation

When a user has `req.orgId`:
- `listInvoices` filters by `org_id`
- `getInvoiceCounts` scopes counts to the org
- `uploadInvoices` stamps `org_id` on new bills
- `exportBillsCsv` includes only org bills

When `req.orgId` is undefined (no org):
- Queries are unscoped (legacy behavior)
- Existing bills without `org_id` remain accessible

## RBAC — Permission Matrix

Defined in `shared/roles.ts`. Each role has explicit permissions (no inheritance).

### Roles (Highest to Lowest Privilege)

| Role | Description |
|------|-------------|
| **owner** | Full access — org deletion, billing, member management |
| **admin** | Full access except org deletion and billing management |
| **reviewer** | Upload, edit, approve invoices + view analytics/fraud |
| **viewer** | Read-only access to invoices and analytics |
| **api_user** | API-only access (sync/async OCR endpoints) |

### Permission Matrix

| Permission | owner | admin | reviewer | viewer | api_user |
|-----------|-------|-------|----------|--------|----------|
| `invoice:list` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `invoice:detail` | ✅ | ✅ | ✅ | ✅ | ✅ |
| `invoice:upload` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `invoice:edit` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `invoice:delete` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `invoice:reextract` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `invoice:approve` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `invoice:export` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `invoice:api_sync` | ✅ | ✅ | ❌ | ❌ | ✅ |
| `invoice:api_async` | ✅ | ✅ | ❌ | ❌ | ✅ |
| `analytics:view` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `fraud:view` | ✅ | ✅ | ✅ | ❌ | ❌ |
| `vendor:list` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `vendor:detail` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `settings:view` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `settings:edit` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `members:list` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `members:invite` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `members:remove` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `members:change_role` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `org:edit` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `org:delete` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `billing:view` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `billing:manage` | ✅ | ❌ | ❌ | ❌ | ❌ |

### Usage in Code

```typescript
import { can } from '../shared/roles.js';
import { ForbiddenError } from '../shared/errors.js';

if (!can(req.orgRole, 'invoice:upload')) {
  throw new ForbiddenError('Insufficient permissions');
}
```

## API Endpoints

All endpoints require JWT authentication. Tenant context is resolved automatically.

| Method | Path | Description | Required Role |
|--------|------|-------------|---------------|
| `POST` | `/api/orgs` | Create organization | Any authenticated user |
| `GET` | `/api/orgs/me` | Get user's org + role | Any member |
| `PATCH` | `/api/orgs` | Update org name/settings | owner, admin |
| `GET` | `/api/orgs/members` | List org members | owner, admin |
| `POST` | `/api/orgs/members` | Invite user to org | owner, admin |
| `PATCH` | `/api/orgs/members/:userId/role` | Change member's role | owner, admin |
| `DELETE` | `/api/orgs/members/:userId` | Remove member | owner, admin |

## Business Rules

1. **One org per user** — a user can only belong to one organization at a time
2. **Owner protection** — the org owner cannot be removed or have their role changed
3. **Role hierarchy enforcement** — only owners can assign the admin role; admins cannot promote to admin
4. **No direct owner assignment** — "owner" role is only set during org creation; transferring ownership is a separate flow (not yet implemented)
5. **Slug uniqueness** — org slugs are auto-generated from names; duplicates get a UUID suffix

## Plan Limits

| Plan | Invoice Limit | Price |
|------|--------------|-------|
| `free` | 50/month | Free |
| `starter` | 500/month | TBD |
| `business` | 5,000/month | TBD |
| `enterprise` | 999,999/month | TBD |

The `invoice_limit` on the Organization model is set from `PLAN_LIMITS` when the org is created. Plan enforcement (checking limit before upload) is planned for Phase 3.

## Database Tables

| Table | PK | Description |
|-------|-----|-------------|
| `organizations` | `org_id` | One row per tenant |
| `org_members` | `(org_id, user_id)` | Maps users to orgs with roles |

Full column details: [DATABASE.md](../../DATABASE.md)
