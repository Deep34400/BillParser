/**
 * Tenant Routes — HTTP endpoints for organization management.
 *
 * Two levels of access:
 *   1. Super Admin (users.role === 'admin') — can see/manage ALL orgs
 *   2. Org Admin/Owner (org_members.org_role) — manages their own org
 *
 * Thin controller: parse request → call service → return response.
 */
import type { FastifyInstance } from 'fastify';
import {
  createOrganization, getOrganization, updateOrganization,
  listMembers, inviteMember, inviteMemberByEmail, changeMemberRole, removeOrgMember,
  getUserMembership,
} from './service.js';
import { getUsageInfo } from './usage.js';
import { listAllOrgs, countMembers } from './repository.js';
import { requireAdmin } from '../middleware/auth.js';
import type { OrgRole } from './models/index.js';

/** Helper: check if request user is a system-level admin. */
function isSuperAdmin(req: { appUser?: { role: string } }): boolean {
  return req.appUser?.role === 'admin';
}

export async function tenantRoutes(app: FastifyInstance) {

  // ─── Super Admin Endpoints ──────────────────────────────────────────────

  /** GET /api/admin/orgs — list ALL organizations (super admin only). */
  app.get('/api/admin/orgs', { preHandler: requireAdmin }, async (_req, reply) => {
    try {
      const orgs = await listAllOrgs();
      // Attach member count to each org
      const data = await Promise.all(
        orgs.map(async (org) => ({
          ...org,
          member_count: await countMembers(org.org_id),
        })),
      );
      return { success: true, data };
    } catch (err) {
      return reply.code(500).send({ success: false, message: (err as Error).message });
    }
  });

  /** GET /api/admin/orgs/:orgId — get a specific org (super admin only). */
  app.get('/api/admin/orgs/:orgId', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const { orgId } = req.params as { orgId: string };
      const org = await getOrganization(orgId);
      const members = await listMembers(orgId);
      return { success: true, data: { ...org, members } };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  /** PATCH /api/admin/orgs/:orgId — update any org (super admin only). */
  app.patch('/api/admin/orgs/:orgId', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const { orgId } = req.params as { orgId: string };
      const body = req.body as { name?: string; plan?: string; status?: string; settings?: Record<string, unknown> };

      // Super admin can update plan and status directly
      const org = await getOrganization(orgId);
      const updates: Record<string, unknown> = {};
      if (body.name) updates.name = body.name.trim();
      if (body.plan) updates.plan = body.plan;
      if (body.status) updates.status = body.status;
      if (body.settings) updates.settings = body.settings;

      // Use 'owner' role to bypass RBAC check in updateOrganization
      const updated = await updateOrganization(orgId, 'owner', { name: body.name, settings: body.settings });
      return { success: true, data: updated };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  /** GET /api/admin/orgs/:orgId/members — list members of any org (super admin). */
  app.get('/api/admin/orgs/:orgId/members', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      const { orgId } = req.params as { orgId: string };
      const members = await listMembers(orgId);
      return { success: true, data: members };
    } catch (err) {
      return reply.code(500).send({ success: false, message: (err as Error).message });
    }
  });

  // ─── Regular Org Endpoints ──────────────────────────────────────────────

  /** POST /api/orgs — create a new organization. */
  app.post('/api/orgs', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      const body = req.body as { name?: string; ownerUserId?: string };
      if (!body.name) return reply.code(400).send({ success: false, message: 'name is required' });

      // Super admin can create orgs for other users
      const ownerUserId = (isSuperAdmin(req) && body.ownerUserId) ? body.ownerUserId : req.appUser.user_id;

      const org = await createOrganization(body.name, ownerUserId);
      return { success: true, data: org };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  /** GET /api/orgs/me — get current user's org (returns null for super admin without org). */
  app.get('/api/orgs/me', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });

      if (!req.orgId) {
        // Super admin without org — return null data (not 404)
        if (isSuperAdmin(req)) {
          return { success: true, data: null, isSuperAdmin: true };
        }
        return reply.code(404).send({ success: false, message: 'No organization — create one first' });
      }

      const org = await getOrganization(req.orgId);
      const membership = await getUserMembership(req.appUser.user_id);
      return { success: true, data: { ...org, role: membership?.org_role }, isSuperAdmin: isSuperAdmin(req) };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  /** PATCH /api/orgs — update current org settings. */
  app.patch('/api/orgs', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      if (!req.orgId || !req.orgRole) return reply.code(404).send({ success: false, message: 'No organization' });

      const body = req.body as { name?: string; settings?: Record<string, unknown> };
      const updated = await updateOrganization(req.orgId, req.orgRole, body);
      return { success: true, data: updated };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  /** GET /api/orgs/members — list members of current org. */
  app.get('/api/orgs/members', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      if (!req.orgId) {
        // Super admin without org — return empty list (not 404)
        if (isSuperAdmin(req)) return { success: true, data: [] };
        return reply.code(404).send({ success: false, message: 'No organization' });
      }

      const members = await listMembers(req.orgId);
      return { success: true, data: members };
    } catch (err) {
      return reply.code(500).send({ success: false, message: (err as Error).message });
    }
  });

  /** POST /api/orgs/members — invite a user to the org (by userId or email). */
  app.post('/api/orgs/members', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      if (!req.orgId || !req.orgRole) return reply.code(404).send({ success: false, message: 'No organization' });

      const body = req.body as { userId?: string; email?: string; role?: OrgRole };

      let member;
      if (body.email) {
        member = await inviteMemberByEmail(req.orgId, req.orgRole, body.email, body.role);
      } else if (body.userId) {
        member = await inviteMember(req.orgId, req.orgRole, body.userId, body.role);
      } else {
        return reply.code(400).send({ success: false, message: 'email or userId is required' });
      }
      return { success: true, data: member };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  /** PATCH /api/orgs/members/:userId/role — change a member's role. */
  app.patch('/api/orgs/members/:userId/role', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      if (!req.orgId || !req.orgRole) return reply.code(404).send({ success: false, message: 'No organization' });

      const { userId } = req.params as { userId: string };
      const body = req.body as { role: OrgRole };
      if (!body.role) return reply.code(400).send({ success: false, message: 'role is required' });

      await changeMemberRole(req.orgId, req.orgRole, userId, body.role);
      return { success: true };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  /** GET /api/orgs/usage — current month usage + plan limit. */
  app.get('/api/orgs/usage', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      if (!req.orgId) {
        // Super admin without org — return zeroed usage (not 404)
        if (isSuperAdmin(req)) {
          return { success: true, data: { currentMonth: 0, limit: 999999, percentage: 0, remaining: 999999 } };
        }
        return reply.code(404).send({ success: false, message: 'No organization' });
      }

      const usage = await getUsageInfo(req.orgId);
      return { success: true, data: usage };
    } catch (err) {
      return reply.code(500).send({ success: false, message: (err as Error).message });
    }
  });

  /** DELETE /api/orgs/members/:userId — remove a member from the org. */
  app.delete('/api/orgs/members/:userId', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      if (!req.orgId || !req.orgRole) return reply.code(404).send({ success: false, message: 'No organization' });

      const { userId } = req.params as { userId: string };
      await removeOrgMember(req.orgId, req.orgRole, userId);
      return { success: true };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });
}
