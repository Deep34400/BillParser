# Tenant Module — Multi-Tenancy, RBAC & Admin Hierarchy

Organizations, membership, role-based access control. Added in Phase 2, extended with super-admin capabilities in Phase 3. Follows the controller → service → repository pattern.

## Directory Structure

```
tenant/
├── models/
│   ├── organization.ts       # Organization Sequelize model
│   ├── orgMember.ts          # OrgMember Sequelize model (composite PK)
│   └── index.ts              # Barrel export + OrgRole type
├── repository.ts             # PostgreSQL CRUD (Sequelize)
├── service.ts                # Business logic (org lifecycle, RBAC enforcement)
├── usage.ts                  # Monthly invoice metering + plan limit enforcement
├── route.ts                  # HTTP endpoints (controller layer)
└── README.md
```

Related files:
- `shared/roles.ts` — RBAC permission matrix (`can()`, `permissionsFor()`)
- `middleware/tenantContext.ts` — Resolves `req.orgId` + `req.orgRole` per request
- `middleware/auth.ts` — `requireAdmin()` guard for super admin endpoints

## Admin Hierarchy

The system has **two levels of administration**:

### 1. Super Admin (System Level)

- **Identified by**: `users.role === 'admin'` in the `users` table
- **Scope**: The entire platform — all organizations, all users, all data
- **Purpose**: Platform operator/administrator who manages the SaaS instance

**Super Admin can:**
- View all organizations across the platform
- Create organizations for any user
- Update any org's plan, status, settings
- Block/unblock any user
- View all invoices (unscoped)
- Manage billing, tokens, and system settings
- See the system-wide audit log

**Super Admin may not have an org:**
When a super admin has no `org_members` record, `req.orgId` stays undefined. All org-related routes (usage, webhooks, members) return **empty/default data** instead of 404. This is intentional — the super admin operates above the organization level.

### 2. Org Admin (Organization Level)

- **Identified by**: `org_members.org_role === 'admin'` (or `'owner'`)
- **Scope**: Only their own organization
- **Purpose**: Organization-level administrator who manages their team

**Org Admin can:**
- Manage org members (invite, remove, change roles)
- Update org settings and name
- View all org invoices
- Manage org webhooks
- See org-specific audit logs

### How the UI Decides What to Show

```
GET /api/orgs/me returns:
  → data: null, isSuperAdmin: true   ← Super admin without org → show admin dashboard
  → data: null, isSuperAdmin: false  ← Regular user without org → show "Create Org" form
  → data: { ... }, isSuperAdmin: true  ← Super admin WITH an org → show admin dashboard
  → data: { ... }, isSuperAdmin: false ← Regular user with org → show org management
```

The frontend reads `localStorage.session_user.role` to determine which view to render:
- `role === 'admin'` → `<SuperAdminOrgDashboard />`
- `role !== 'admin'` → `<RegularUserOrgView />`

## How It Works

### Tenant Context Middleware

After authentication (`authPlugin`), the `tenantPlugin` runs:

```
Every authenticated request
  → middleware/tenantContext.ts runs
  → Looks up the user's OrgMember record via findOne(userId)
  → If found:
    - Sets req.orgId = member.org_id
    - Sets req.orgRole = member.org_role
  → If not found:
    - req.orgId and req.orgRole remain undefined
    - User still works (legacy / no-org mode / super admin mode)
```

This is **non-fatal** — users without an organization can still use the system. Bills uploaded without org context have `org_id = null`.

### Organization Lifecycle

```
1. User creates an org (or super admin creates one)
   → POST /api/orgs { name, ownerUserId? }
   → Super admin can specify ownerUserId to create org for another user
   → service.createOrganization(name, ownerUserId)
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
- Queries are unscoped (legacy behavior / super admin)
- Existing bills without `org_id` remain accessible

## RBAC — Permission Matrix

Defined in `shared/roles.ts`. Each role has explicit permissions (no inheritance).

### Roles (Highest to Lowest Privilege)

| Role | Level | Description |
|------|-------|-------------|
| **Super Admin** | System (`users.role`) | Full platform access — all orgs, all users, all data |
| **owner** | Org (`org_members.org_role`) | Full org access — deletion, billing, member management |
| **admin** | Org | Full org access except org deletion and billing management |
| **reviewer** | Org | Upload, edit, approve invoices + view analytics/fraud |
| **viewer** | Org | Read-only access to invoices and analytics |
| **api_user** | Org | API-only access (sync/async OCR endpoints) |

### Permission Matrix

| Permission | Super Admin | owner | admin | reviewer | viewer | api_user |
|-----------|-------------|-------|-------|----------|--------|----------|
| View all orgs | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Create / delete orgs | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage any org plan | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Block / unblock users | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `invoice:list` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `invoice:upload` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `invoice:approve` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| `members:manage` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `settings:edit` | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| `billing:manage` | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |

### Usage in Code

```typescript
// Org-level check
import { can } from '../shared/roles.js';
import { ForbiddenError } from '../shared/errors.js';
if (!can(req.orgRole, 'invoice:upload')) {
  throw new ForbiddenError('Insufficient permissions');
}

// System-level check (super admin)
import { requireAdmin } from '../middleware/auth.js';
app.get('/api/admin/orgs', { preHandler: requireAdmin }, handler);
```

## API Endpoints

### Super Admin Endpoints

| Method | Path | Description | Auth |
|--------|------|-------------|------|
| `GET` | `/api/admin/orgs` | List ALL organizations | `requireAdmin` |
| `GET` | `/api/admin/orgs/:orgId` | Get specific org + members | `requireAdmin` |
| `PATCH` | `/api/admin/orgs/:orgId` | Update org (plan, status, name) | `requireAdmin` |
| `GET` | `/api/admin/orgs/:orgId/members` | List members of any org | `requireAdmin` |
| `GET` | `/api/admin/users` | List all users | `requireAdmin` |
| `POST` | `/api/admin/users` | Create user | `requireAdmin` |
| `PATCH` | `/api/admin/users/:id/block` | Block user | `requireAdmin` |
| `PATCH` | `/api/admin/users/:id/unblock` | Unblock user | `requireAdmin` |

### Organization Endpoints

All require JWT authentication. Tenant context resolved automatically.

| Method | Path | Description | Required Role |
|--------|------|-------------|---------------|
| `POST` | `/api/orgs` | Create organization | Any authenticated |
| `GET` | `/api/orgs/me` | Get user's org + role | Any member |
| `PATCH` | `/api/orgs` | Update org name/settings | owner, admin |
| `GET` | `/api/orgs/members` | List org members | owner, admin |
| `POST` | `/api/orgs/members` | Invite user to org | owner, admin |
| `PATCH` | `/api/orgs/members/:userId/role` | Change member's role | owner, admin |
| `DELETE` | `/api/orgs/members/:userId` | Remove member | owner, admin |
| `GET` | `/api/orgs/usage` | Monthly usage info | Any member |

### Graceful Handling When No Org Exists

Routes that would normally return 404 when `req.orgId` is undefined now check for super admin status:

| Route | Super Admin (no org) | Regular User (no org) |
|-------|---------------------|-----------------------|
| `GET /api/orgs/me` | `{ data: null, isSuperAdmin: true }` | 404 |
| `GET /api/orgs/usage` | `{ data: { currentMonth: 0, limit: 999999, ... } }` | 404 |
| `GET /api/orgs/members` | `{ data: [] }` | 404 |
| `GET /api/webhooks` | `{ data: [], metadata: { availableEvents } }` | 404 |

## Business Rules

1. **One org per user** — a user can only belong to one organization at a time
2. **Owner protection** — the org owner cannot be removed or have their role changed
3. **Role hierarchy enforcement** — only owners can assign the admin role; admins cannot promote to admin
4. **No direct owner assignment** — "owner" role is only set during org creation
5. **Slug uniqueness** — org slugs are auto-generated from names; duplicates get a UUID suffix
6. **Super admin bypass** — super admin can create orgs for any user via `ownerUserId` param

## Plan Limits

| Plan | Invoice Limit | Rate Limit (req/min) |
|------|--------------|----------------------|
| `free` | 50/month | 30 |
| `starter` | 500/month | 120 |
| `business` | 5,000/month | 300 |
| `enterprise` | 999,999/month | 1000 |

The `invoice_limit` on the Organization model is set from `PLAN_LIMITS` when the org is created. Usage enforcement checks the limit before every upload (when `orgId` is present).

## Database Tables

| Table | PK | Description |
|-------|-----|-------------|
| `organizations` | `org_id` | One row per tenant |
| `org_members` | `(org_id, user_id)` | Maps users to orgs with roles |

Full column details: [DATABASE.md](../../DATABASE.md)
