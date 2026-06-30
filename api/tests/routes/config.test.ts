import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';

it('GET /api/config lists providers with configured flags', async () => {
  const app = await buildApp();
  const res = await app.inject({ method: 'GET', url: '/api/config' });
  expect(res.statusCode).toBe(200);
  const body = res.json();
  expect(body.providers.map((p: any) => p.name).sort()).toContain('mistral');
  expect(body.providers[0]).toHaveProperty('configured');
  expect(body).toHaveProperty('activeProvider');
  await app.close();
});
