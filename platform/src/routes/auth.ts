/**
 * Auth routes — login, session management, API key management.
 */
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import {
  getUserByEmail, verifyPassword, getUser,
  generateApiKey, hashApiKey, apiKeyPrefix,
  createApiKeyDoc, listApiKeysForUser, deleteApiKey,
  type ApiKeyDoc,
} from '../models/users.js';
import { clientUserView } from '../lib/clientUser.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** POST /api/auth/login — email + password → JWT token */
  app.post('/api/auth/login', async (req, reply) => {
    const body = req.body as { email?: string; password?: string };
    if (!body.email || !body.password) {
      return reply.status(400).send({ success: false, message: 'Email and password are required' });
    }

    const user = await getUserByEmail(body.email);
    if (!user) {
      return reply.status(401).send({ success: false, message: 'Invalid email or password' });
    }

    if (!verifyPassword(body.password, user.password_hash)) {
      return reply.status(401).send({ success: false, message: 'Invalid email or password' });
    }

    if (user.status === 'blocked') {
      return reply.status(403).send({ success: false, message: 'Account is blocked — contact admin' });
    }

    const token = app.jwt.sign(
      { user_id: user.user_id, role: user.role },
      { expiresIn: '7d' },
    );

    return reply.send({
      success: true,
      data: {
        token,
        user: clientUserView(user),
      },
    });
  });

  /** POST /api/auth/api-keys — generate a new API key for current user */
  app.post('/api/auth/api-keys', async (req, reply) => {
    const user = req.appUser;
    if (!user) return reply.status(401).send({ success: false, message: 'Not authenticated' });

    const body = req.body as { label?: string } | undefined;
    const rawKey = generateApiKey();
    const doc: ApiKeyDoc = {
      key_id: randomBytes(16).toString('hex'),
      user_id: user.user_id,
      key_hash: hashApiKey(rawKey),
      key_prefix: apiKeyPrefix(rawKey),
      api_key: rawKey,
      label: body?.label ?? 'Default',
      created_at: new Date().toISOString(),
    };

    await createApiKeyDoc(doc);

    return reply.status(201).send({
      success: true,
      data: { key_id: doc.key_id, api_key: rawKey, label: doc.label, prefix: doc.key_prefix, created_at: doc.created_at },
      message: 'API key created — you can copy it anytime from Account.',
    });
  });

  /** GET /api/auth/api-keys — list current user's API keys (full key for copy) */
  app.get('/api/auth/api-keys', async (req, reply) => {
    const user = req.appUser;
    if (!user) return reply.status(401).send({ success: false, message: 'Not authenticated' });

    const keys = await listApiKeysForUser(user.user_id);
    return reply.send({
      success: true,
      data: keys.map((k) => ({
        key_id: k.key_id,
        prefix: k.key_prefix,
        api_key: k.api_key ?? null,
        label: k.label,
        created_at: k.created_at,
        last_used_at: k.last_used_at ?? null,
      })),
    });
  });

  /** DELETE /api/auth/api-keys/:keyId — revoke an API key */
  app.delete('/api/auth/api-keys/:keyId', async (req, reply) => {
    const user = req.appUser;
    if (!user) return reply.status(401).send({ success: false, message: 'Not authenticated' });

    const { keyId } = req.params as { keyId: string };
    const keys = await listApiKeysForUser(user.user_id);
    const target = keys.find((k) => k.key_id === keyId);
    if (!target) return reply.status(404).send({ success: false, message: 'API key not found' });

    await deleteApiKey(keyId);
    return reply.send({ success: true, message: 'API key revoked' });
  });
}
