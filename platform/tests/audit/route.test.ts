import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import type { UserDoc } from '../../src/users/repository.js';

const mockGetAuditLogs = vi.hoisted(() => vi.fn());

vi.mock('../../src/audit/service.js', () => ({
  getAuditLogs: mockGetAuditLogs,
  audit: vi.fn(),
}));

import { auditRoutes } from '../../src/audit/route.js';

function makeUser(overrides: Partial<UserDoc> = {}): UserDoc {
  return {
    user_id: 'user-regular',
    email: 'user@test.com',
    name: 'Regular User',
    password_hash: 'hash',
    role: 'user',
    status: 'active',
    api_key_hash: 'keyhash',
    api_key_prefix: 'prefix',
    token_balance: 100,
    total_tokens_used: 0,
    total_ocr_count: 0,
    total_cost_usd: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('audit routes', () => {
  let app: ReturnType<typeof Fastify>;
  let currentUser: UserDoc | undefined;

  beforeEach(async () => {
    mockGetAuditLogs.mockReset();
    mockGetAuditLogs.mockResolvedValue({ logs: [], total: 0 });

    app = Fastify();
    app.decorateRequest('appUser', null);
    app.addHook('preHandler', async (req) => {
      req.appUser = currentUser;
    });
    await auditRoutes(app);
  });

  afterEach(async () => {
    await app.close();
  });

  it('scopes regular users to their own userId', async () => {
    currentUser = makeUser({ user_id: 'user-regular', role: 'user' });

    const res = await app.inject({
      method: 'GET',
      url: '/api/audit/logs?userId=other-user',
    });

    expect(res.statusCode).toBe(200);
    expect(mockGetAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-regular' }),
    );
  });

  it('lets admins query all logs when userId is omitted', async () => {
    currentUser = makeUser({ user_id: 'admin-1', role: 'admin' });

    const res = await app.inject({ method: 'GET', url: '/api/audit/logs' });

    expect(res.statusCode).toBe(200);
    expect(mockGetAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ userId: undefined }),
    );
  });

  it('lets admins filter by userId query param', async () => {
    currentUser = makeUser({ user_id: 'admin-1', role: 'admin' });

    await app.inject({ method: 'GET', url: '/api/audit/logs?userId=specific-user' });

    expect(mockGetAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'specific-user' }),
    );
  });

  it('uses default limit 50 and offset 0', async () => {
    currentUser = makeUser();

    await app.inject({ method: 'GET', url: '/api/audit/logs' });

    expect(mockGetAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, offset: 0 }),
    );
  });

  it('passes custom limit and offset from query params', async () => {
    currentUser = makeUser();

    await app.inject({ method: 'GET', url: '/api/audit/logs?limit=10&offset=20' });

    expect(mockGetAuditLogs).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20 }),
    );
  });

  it('returns 401 when unauthenticated', async () => {
    currentUser = undefined;

    const res = await app.inject({ method: 'GET', url: '/api/audit/logs' });

    expect(res.statusCode).toBe(401);
    expect(mockGetAuditLogs).not.toHaveBeenCalled();
  });
});
