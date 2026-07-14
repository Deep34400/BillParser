/**
 * Account routes — self-service for authenticated users.
 * GET /api/account — current user info + token balance
 * GET /api/account/transactions — token usage history
 */
import type { FastifyInstance } from 'fastify';
import { getUserTransactions } from '../models/users.js';
import { clientUserView } from '../lib/clientUser.js';

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/account', async (req, reply) => {
    const user = req.appUser;
    if (!user) return reply.status(401).send({ success: false, message: 'Not authenticated' });

    return reply.send({ success: true, data: clientUserView(user) });
  });

  app.get('/api/account/transactions', async (req, reply) => {
    const user = req.appUser;
    if (!user) return reply.status(401).send({ success: false, message: 'Not authenticated' });

    const limit = Number((req.query as Record<string, string>).limit) || 50;
    const txs = await getUserTransactions(user.user_id, limit);
    return reply.send({ success: true, data: txs });
  });
}
