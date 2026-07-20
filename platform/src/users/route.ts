/**
 * User Routes — thin HTTP controller for auth, account, and admin endpoints.
 * All business logic lives in service.ts. This file only handles:
 *   - Request validation (required fields, types)
 *   - Calling the appropriate service function
 *   - Formatting the HTTP response
 */
import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/auth.js';
import {
  login, issueApiKey, revokeApiKey, getApiKeys,
  registerUser, blockUser, unblockUser, resetPassword,
  findUser, findAllUsers, addTokens, getTransactions,
} from './service.js';
import { clientUserView, sanitizeUser } from './dto.js';

export async function userRoutes(app: FastifyInstance): Promise<void> {

  // ── Auth ────────────────────────────────────────────────────────

  app.post('/api/auth/login', async (req, reply) => {
    const body = req.body as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.status(400).send({ success: false, message: 'Email and password are required' });
    }

    const result = await login(body.email, body.password);
    if ('error' in result) {
      return reply.status(result.status).send({ success: false, message: result.error });
    }

    const token = app.jwt.sign(
      { user_id: result.user.user_id, role: result.user.role },
      { expiresIn: '7d' },
    );
    return reply.send({ success: true, data: { token, user: clientUserView(result.user) } });
  });

  // ── API Keys ────────────────────────────────────────────────────

  app.post('/api/auth/api-keys', async (req, reply) => {
    const user = req.appUser;
    if (!user) return reply.status(401).send({ success: false, message: 'Not authenticated' });

    const body = req.body as { label?: string } | undefined;
    const doc = await issueApiKey(user.user_id, body?.label);
    return reply.status(201).send({
      success: true,
      data: { key_id: doc.key_id, api_key: doc.api_key, label: doc.label, prefix: doc.key_prefix, created_at: doc.created_at },
      message: 'API key created — you can copy it anytime from Account.',
    });
  });

  app.get('/api/auth/api-keys', async (req, reply) => {
    const user = req.appUser;
    if (!user) return reply.status(401).send({ success: false, message: 'Not authenticated' });

    const keys = await getApiKeys(user.user_id);
    return reply.send({
      success: true,
      data: keys.map((k) => ({
        key_id: k.key_id, prefix: k.key_prefix, api_key: k.api_key ?? null,
        label: k.label, created_at: k.created_at, last_used_at: k.last_used_at ?? null,
      })),
    });
  });

  app.delete('/api/auth/api-keys/:keyId', async (req, reply) => {
    const user = req.appUser;
    if (!user) return reply.status(401).send({ success: false, message: 'Not authenticated' });

    const { keyId } = req.params as { keyId: string };
    const found = await revokeApiKey(user.user_id, keyId);
    if (!found) return reply.status(404).send({ success: false, message: 'API key not found' });
    return reply.send({ success: true, message: 'API key revoked' });
  });

  // ── Account (self-service) ──────────────────────────────────────

  app.get('/api/account', async (req, reply) => {
    const user = req.appUser;
    if (!user) return reply.status(401).send({ success: false, message: 'Not authenticated' });
    return reply.send({ success: true, data: clientUserView(user) });
  });

  app.get('/api/account/transactions', async (req, reply) => {
    const user = req.appUser;
    if (!user) return reply.status(401).send({ success: false, message: 'Not authenticated' });
    const limit = Number((req.query as Record<string, string>).limit) || 50;
    const txs = await getTransactions(user.user_id, limit);
    return reply.send({ success: true, data: txs });
  });

  // ── Admin (requires admin role) ─────────────────────────────────

  app.get('/api/admin/users', { preHandler: requireAdmin }, async (_req, reply) => {
    const users = await findAllUsers();
    return reply.send({ success: true, data: users.map(sanitizeUser) });
  });

  app.post('/api/admin/users', { preHandler: requireAdmin }, async (req, reply) => {
    const body = req.body as { email?: string; name?: string; password?: string; role?: 'admin' | 'user'; initial_balance?: number };
    if (!body.email || !body.name || !body.password) {
      return reply.status(400).send({ success: false, message: 'email, name, and password are required' });
    }

    const result = await registerUser({
      email: body.email,
      name: body.name,
      password: body.password,
      role: body.role,
      initialBalance: body.initial_balance,
    });

    if ('error' in result) {
      return reply.status(result.status).send({ success: false, message: result.error });
    }

    return reply.status(201).send({
      success: true,
      data: sanitizeUser(result),
      message: 'User created. They can login with email + password.',
    });
  });

  app.get('/api/admin/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = await findUser(id);
    if (!user) return reply.status(404).send({ success: false, message: 'User not found' });
    return reply.send({ success: true, data: sanitizeUser(user) });
  });

  app.patch('/api/admin/users/:id/block', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await blockUser(id);
    return reply.send({ success: true, message: 'User blocked' });
  });

  app.patch('/api/admin/users/:id/unblock', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await unblockUser(id);
    return reply.send({ success: true, message: 'User unblocked' });
  });

  app.post('/api/admin/users/:id/tokens', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { amount?: number; description?: string };
    if (!body.amount || body.amount <= 0) {
      return reply.status(400).send({ success: false, message: 'amount must be > 0' });
    }
    const tx = await addTokens(id, body.amount, body.description ?? 'Admin top-up');
    return reply.send({ success: true, data: tx });
  });

  app.get('/api/admin/users/:id/transactions', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const txs = await getTransactions(id);
    return reply.send({ success: true, data: txs });
  });

  app.patch('/api/admin/users/:id/reset-password', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { password?: string };
    const result = await resetPassword(id, body?.password ?? '');
    if (result.error) return reply.status(400).send({ success: false, message: result.error });
    return reply.send({ success: true, message: 'Password reset' });
  });
}
