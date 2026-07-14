/**
 * Admin routes — user management, token operations.
 * All routes require admin role.
 */
import type { FastifyInstance } from 'fastify';
import { v4 as uuid } from 'uuid';
import { requireAdmin } from '../middleware/auth.js';
import {
  createUser, getUser, listUsers, updateUser, addTokens,
  getUserTransactions, hashPassword,
  type UserDoc, type UserRole,
} from '../models/users.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  /** GET /api/admin/users */
  app.get('/api/admin/users', async (_req, reply) => {
    const users = await listUsers();
    return reply.send({ success: true, data: users.map(sanitizeUser) });
  });

  /** POST /api/admin/users — create user with email + password */
  app.post('/api/admin/users', async (req, reply) => {
    const body = req.body as { email?: string; name?: string; password?: string; role?: UserRole; initial_balance?: number };
    if (!body.email || !body.name || !body.password) {
      return reply.status(400).send({ success: false, message: 'email, name, and password are required' });
    }
    if (body.password.length < 6) {
      return reply.status(400).send({ success: false, message: 'Password must be at least 6 characters' });
    }

    const { getUserByEmail } = await import('../models/users.js');
    const existing = await getUserByEmail(body.email);
    if (existing) {
      return reply.status(409).send({ success: false, message: 'A user with this email already exists' });
    }

    const now = new Date().toISOString();
    const user: UserDoc = {
      user_id: uuid(),
      email: body.email.toLowerCase().trim(),
      name: body.name,
      password_hash: hashPassword(body.password),
      role: body.role ?? 'user',
      status: 'active',
      api_key_hash: '',
      api_key_prefix: '',
      token_balance: body.initial_balance ?? 0,
      total_tokens_used: 0,
      total_ocr_count: 0,
      total_cost_usd: 0,
      created_at: now,
      updated_at: now,
    };

    await createUser(user);

    return reply.status(201).send({
      success: true,
      data: sanitizeUser(user),
      message: 'User created. They can login with email + password.',
    });
  });

  /** GET /api/admin/users/:id */
  app.get('/api/admin/users/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const user = await getUser(id);
    if (!user) return reply.status(404).send({ success: false, message: 'User not found' });
    return reply.send({ success: true, data: sanitizeUser(user) });
  });

  /** PATCH /api/admin/users/:id/block */
  app.patch('/api/admin/users/:id/block', async (req, reply) => {
    const { id } = req.params as { id: string };
    await updateUser(id, { status: 'blocked' });
    return reply.send({ success: true, message: 'User blocked' });
  });

  /** PATCH /api/admin/users/:id/unblock */
  app.patch('/api/admin/users/:id/unblock', async (req, reply) => {
    const { id } = req.params as { id: string };
    await updateUser(id, { status: 'active' });
    return reply.send({ success: true, message: 'User unblocked' });
  });

  /** POST /api/admin/users/:id/tokens — add balance (INR amount) */
  app.post('/api/admin/users/:id/tokens', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { amount?: number; description?: string };
    if (!body.amount || body.amount <= 0) {
      return reply.status(400).send({ success: false, message: 'amount must be > 0' });
    }

    const tx = await addTokens(id, body.amount, body.description ?? 'Admin top-up');
    return reply.send({ success: true, data: tx });
  });

  /** GET /api/admin/users/:id/transactions */
  app.get('/api/admin/users/:id/transactions', async (req, reply) => {
    const { id } = req.params as { id: string };
    const txs = await getUserTransactions(id);
    return reply.send({ success: true, data: txs });
  });

  /** PATCH /api/admin/users/:id/reset-password */
  app.patch('/api/admin/users/:id/reset-password', async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as { password?: string };
    if (!body.password || body.password.length < 6) {
      return reply.status(400).send({ success: false, message: 'Password must be at least 6 characters' });
    }
    await updateUser(id, { password_hash: hashPassword(body.password) });
    return reply.send({ success: true, message: 'Password reset' });
  });
}

function sanitizeUser(u: UserDoc) {
  const { password_hash: _, api_key_hash: _2, ...rest } = u;
  return rest;
}
