import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import { authPlugin } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { rateLimitPlugin } from './middleware/rateLimit.js';
import { userRoutes } from './users/route.js';
import { billRoutes } from './ocr/route.js';
import { analyticsRoutes } from './analytics/route.js';
import { fraudRoutes } from './fraud/route.js';
import { vendorRoutes } from './vendor/route.js';
import { configRoutes } from './routes/config.js';
import { settingsRoutes } from './routes/settings.js';
import { odometerRoutes } from './odometerOcr/route.js';
import { auditRoutes } from './audit/route.js';
import { webhookRoutes } from './webhook/route.js';
import { queueRoutes } from './routes/queue.js';

const DEV_JWT_SECRET = 'dev-secret-change-in-production';

/**
 * JWT signing secret.
 *
 * The dev fallback is committed to this repo, so anyone could forge an admin
 * session with it. Outside development that is a full auth bypass, not a
 * warning — so refuse to boot rather than start with a known-public secret.
 */
function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  const isProd = (process.env.NODE_ENV ?? 'development') === 'production';

  if (isProd) {
    if (!secret) {
      throw new Error(
        'JWT_SECRET is not set. Refusing to start in production with the committed '
        + 'dev fallback — it is public in this repository and would let anyone forge '
        + 'an admin session. Inject it from Secret Manager (--set-secrets).',
      );
    }
    if (secret === DEV_JWT_SECRET) {
      throw new Error(
        'JWT_SECRET is set to the committed dev fallback value. Refusing to start in '
        + 'production — generate a fresh random secret.',
      );
    }
    if (secret.length < 32) {
      throw new Error(
        `JWT_SECRET is too short (${secret.length} chars). Use at least 32 characters `
        + 'of random data.',
      );
    }
  } else if (!secret) {
    console.warn('[auth] JWT_SECRET unset — using the dev fallback. Never do this in production.');
  }

  return secret || DEV_JWT_SECRET;
}

const JWT_SECRET = resolveJwtSecret();

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  await app.register(jwt, { secret: JWT_SECRET });

  await app.register(authPlugin);
  await app.register(rateLimitPlugin);
  app.setErrorHandler(errorHandler);

  await app.register(userRoutes);
  await app.register(billRoutes);
  await app.register(analyticsRoutes);
  await app.register(fraudRoutes);
  await app.register(vendorRoutes);
  await app.register(configRoutes);
  await app.register(settingsRoutes);
  await app.register(odometerRoutes);
  await app.register(auditRoutes);
  await app.register(webhookRoutes);
  await app.register(queueRoutes);

  app.get('/api/health', async () => ({
    success: true,
    message: 'OK',
    data: { status: 'healthy', timestamp: new Date().toISOString() },
    metadata: {},
    errors: [],
  }));

  return app;
}
