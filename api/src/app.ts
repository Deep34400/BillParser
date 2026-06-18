import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { configRoutes } from './routes/config.js';
import { invoiceRoutes } from './routes/invoices.js';
import { analyticsRoutes } from './routes/analytics.js';
import { settingsRoutes } from './routes/settings.js';
import { exportRoutes } from './routes/export.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 50 } });
  await app.register(configRoutes);
  await app.register(invoiceRoutes);
  await app.register(exportRoutes);
  await app.register(analyticsRoutes);
  await app.register(settingsRoutes);
  return app;
}
