/**
 * Tenant Routes — HTTP endpoints for organization management.
 *
 * Thin controller: parse request → call service → return response.
 */
import type { FastifyInstance } from 'fastify';
import {
  createOrganization, getOrganization, updateOrganization,
  listMembers, inviteMember, changeMemberRole, removeOrgMember,
  getUserMembership,
} from './service.js';
import type { OrgRole } from './models/index.js';

export async function tenantRoutes(app: FastifyInstance) {

  /** POST /api/orgs — create a new organization. */
  app.post('/api/orgs', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      const body = req.body as { name?: string };
      if (!body.name) return reply.code(400).send({ success: false, message: 'name is required' });

      const org = await createOrganization(body.name, req.appUser.user_id);
      return { success: true, data: org };
    } catch (err) {
      const code = (err as any)?.statusCode ?? 500;
      return reply.code(code).send({ success: false, message: (err as Error).message });
    }
  });

  /** GET /api/orgs/me — get current user's org. */
  app.get('/api/orgs/me', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      if (!req.orgId) return reply.code(404).send({ success: false, message: 'No organization — create one first' });

      const org = await getOrganization(req.orgId);
      const membership = await getUserMembership(req.appUser.user_id);
      return { success: true, data: { ...org, role: membership?.org_role } };
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
      if (!req.orgId) return reply.code(404).send({ success: false, message: 'No organization' });

      const members = await listMembers(req.orgId);
      return { success: true, data: members };
    } catch (err) {
      return reply.code(500).send({ success: false, message: (err as Error).message });
    }
  });

  /** POST /api/orgs/members — invite a user to the org. */
  app.post('/api/orgs/members', async (req, reply) => {
    try {
      if (!req.appUser) return reply.status(401).send({ success: false, message: 'Authentication required' });
      if (!req.orgId || !req.orgRole) return reply.code(404).send({ success: false, message: 'No organization' });

      const body = req.body as { userId: string; role?: OrgRole };
      if (!body.userId) return reply.code(400).send({ success: false, message: 'userId is required' });

      const member = await inviteMember(req.orgId, req.orgRole, body.userId, body.role);
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
