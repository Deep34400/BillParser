import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import { authPlugin } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { billRoutes } from './routes/bills.js';
import { analyticsRoutes } from './routes/analytics.js';
import { fraudRoutes } from './routes/fraud.js';
import { configRoutes } from './routes/config.js';
import { settingsRoutes } from './routes/settings.js';
import { adminRoutes } from './routes/admin.js';
import { accountRoutes } from './routes/account.js';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

export async function buildApp() {
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  await app.register(jwt, { secret: JWT_SECRET });

  await app.register(authPlugin);

  await app.register(authRoutes);
  await app.register(billRoutes);
  await app.register(analyticsRoutes);
  await app.register(fraudRoutes);
  await app.register(configRoutes);
  await app.register(settingsRoutes);
  await app.register(adminRoutes);
  await app.register(accountRoutes);

  app.get('/api/health', async () => ({
    success: true,
    message: 'OK',
    data: { status: 'healthy', timestamp: new Date().toISOString() },
    metadata: {},
    errors: [],
  }));

  return app;
}
