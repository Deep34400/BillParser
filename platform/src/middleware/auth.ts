/**
 * Authentication middleware — supports JWT session tokens AND API keys.
 *
 * JWT: Authorization: Bearer eyJhbG... (from /api/auth/login)
 * API: Authorization: Bearer inv_xxxx... (from /api/auth/api-keys)
 */
import type { FastifyRequest, FastifyReply, FastifyInstance, HookHandlerDoneFunction } from 'fastify';
import fp from 'fastify-plugin';
import { hashApiKey, getUserByApiKeyHash, getUser, type UserDoc } from '../models/users.js';
import { env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyRequest {
    appUser?: UserDoc;
  }
}

const PUBLIC_PATHS = ['/api/health', '/api/config', '/api/auth/login'];

function isPublic(path: string): boolean {
  return PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
}

/** True for GET /api/invoices/:id/file — browsers load this in <iframe>/<img> without Authorization. */
function isInvoiceFilePath(pathname: string): boolean {
  return /^\/api\/invoices\/[^/]+\/file$/.test(pathname);
}

/**
 * Resolve bearer token from Authorization header, or from ?token= on invoice file routes only
 * (iframe/img cannot set Authorization headers).
 */
export function bearerFromRequest(req: { headers: { authorization?: string }; url: string }): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);

  const pathname = req.url.split('?')[0] ?? '';
  if (!isInvoiceFilePath(pathname)) return undefined;

  try {
    const q = new URL(req.url, 'http://localhost').searchParams.get('token');
    return q || undefined;
  } catch {
    return undefined;
  }
}

export const authPlugin = fp(async function authPluginFn(app: FastifyInstance): Promise<void> {
  app.decorateRequest('appUser', undefined);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (isPublic(req.url.split('?')[0])) return;

    const token = bearerFromRequest(req);
    if (!token) {
      if (env.localDev) return;
      return reply.status(401).send({ success: false, message: 'Authentication required' });
    }

    if (token.startsWith('eyJ')) {
      try {
        const decoded = app.jwt.verify<{ user_id: string; role: string }>(token);
        const user = await getUser(decoded.user_id);
        if (!user) return reply.status(401).send({ success: false, message: 'User not found' });
        if (user.status === 'blocked') return reply.status(403).send({ success: false, message: 'Account is blocked' });
        req.appUser = user;
        return;
      } catch {
        return reply.status(401).send({ success: false, message: 'Invalid or expired session' });
      }
    }

    if (token.startsWith('inv_')) {
      const hash = hashApiKey(token);
      const user = await getUserByApiKeyHash(hash);
      if (!user) return reply.status(401).send({ success: false, message: 'Invalid API key' });
      if (user.status === 'blocked') return reply.status(403).send({ success: false, message: 'Account is blocked' });
      req.appUser = user;
      return;
    }

    return reply.status(401).send({ success: false, message: 'Invalid token format' });
  });
});

export function requireAdmin(req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction): void {
  if (!req.appUser || req.appUser.role !== 'admin') {
    reply.status(403).send({ success: false, message: 'Admin access required' });
    return;
  }
  done();
}
