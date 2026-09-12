/**
 * Tenant context middleware — resolves the authenticated user's org membership.
 *
 * Runs AFTER authPlugin (which sets req.appUser).
 * Looks up the user's OrgMember record and attaches:
 *   req.orgId   — the organization they belong to
 *   req.orgRole — their role within that org (owner/admin/reviewer/viewer/api_user)
 *
 * If the user has no org membership, orgId and orgRole stay undefined.
 * Legacy admin users (from before multi-tenancy) still work — they just
 * don't have org context, and existing routes handle that gracefully.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { OrgMember } from '../tenant/models/index.js';
import type { OrgRole } from '../tenant/models/index.js';

declare module 'fastify' {
  interface FastifyRequest {
    orgId?: string;
    orgRole?: OrgRole;
  }
}

export const tenantPlugin = fp(async function tenantPluginFn(app: FastifyInstance): Promise<void> {
  app.decorateRequest('orgId', undefined);
  app.decorateRequest('orgRole', undefined);

  app.addHook('onRequest', async (req: FastifyRequest, _reply: FastifyReply) => {
    // Only resolve tenant if user is authenticated
    if (!req.appUser) return;

    try {
      const membership = await OrgMember.findOne({
        where: { userId: req.appUser.user_id },
      });

      if (membership) {
        req.orgId = membership.orgId;
        req.orgRole = membership.orgRole as OrgRole;
      }
    } catch {
      // Non-fatal — org lookup failure should never block the request.
      // User still works without org context (backward compatible).
    }
  });
});
