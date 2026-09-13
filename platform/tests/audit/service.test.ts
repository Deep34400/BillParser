import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'fixed-log-id'),
}));

vi.mock('../../src/audit/models/index.js', () => ({
  AuditLog: {
    create: mockCreate,
    findAndCountAll: vi.fn(),
  },
  initAuditLogModel: vi.fn(),
}));

import { audit } from '../../src/audit/service.js';

describe('audit service', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never throws when DB insert fails (fire-and-forget)', async () => {
    mockCreate.mockRejectedValue(new Error('db down'));

    expect(() =>
      audit('invoice:upload', { userId: 'u1', resourceType: 'bill', resourceId: 'b1' }),
    ).not.toThrow();

    await vi.waitFor(() => {
      expect(console.error).toHaveBeenCalledWith('[audit] Failed to write audit log:', expect.any(Error));
    });
  });

  it('calls AuditLog.create with action, userId, resourceType, resourceId', async () => {
    audit('invoice:approve', {
      userId: 'user-42',
      resourceType: 'bill',
      resourceId: 'bill-99',
    });

    await vi.waitFor(() => expect(mockCreate).toHaveBeenCalledOnce());

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        logId: 'fixed-log-id',
        userId: 'user-42',
        action: 'invoice:approve',
        resourceType: 'bill',
        resourceId: 'bill-99',
      }),
    );
  });
});
