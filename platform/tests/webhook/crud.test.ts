import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/webhook/repository.js', () => ({
  createWebhook: vi.fn(),
  listWebhooks: vi.fn(),
  getWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
}));

vi.mock('../../src/audit/service.js', () => ({
  audit: vi.fn(),
}));

import {
  createEndpoint,
  toggleEndpoint,
  removeEndpoint,
} from '../../src/webhook/service.js';
import {
  createWebhook,
  getWebhook,
  updateWebhook,
  deleteWebhook,
} from '../../src/webhook/repository.js';
import { ValidationError, NotFoundError } from '../../src/shared/errors.js';
import type { WebhookEndpointDoc } from '../../src/webhook/repository.js';

const mockCreate = vi.mocked(createWebhook);
const mockGet = vi.mocked(getWebhook);
const mockUpdate = vi.mocked(updateWebhook);
const mockDelete = vi.mocked(deleteWebhook);

function makeEndpoint(overrides: Partial<WebhookEndpointDoc> = {}): WebhookEndpointDoc {
  return {
    endpoint_id: 'ep-1',
    user_id: 'user-1',
    url: 'https://example.com/webhook',
    events: ['invoice.completed'],
    secret: 'whsec_abc123',
    active: true,
    description: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('createEndpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockImplementation(async (doc) => doc);
  });

  it('rejects invalid http URLs that are not localhost', async () => {
    await expect(
      createEndpoint('user-1', 'http://evil.example.com/hook', ['invoice.completed']),
    ).rejects.toThrow(ValidationError);

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects empty URL', async () => {
    await expect(
      createEndpoint('user-1', '', ['invoice.completed']),
    ).rejects.toThrow(ValidationError);
  });

  it('accepts valid https URLs', async () => {
    const result = await createEndpoint(
      'user-1',
      'https://hooks.example.com/invoices',
      ['invoice.completed'],
      'prod hook',
    );

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result.url).toBe('https://hooks.example.com/invoices');
    expect(result.user_id).toBe('user-1');
    expect(result.events).toEqual(['invoice.completed']);
    expect(result.description).toBe('prod hook');
    expect(result.secret).toMatch(/^whsec_/);
    expect(result.active).toBe(true);
  });

  it('accepts http://localhost for local testing', async () => {
    await createEndpoint('user-1', 'http://localhost:3000/webhook', ['invoice.uploaded']);

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate.mock.calls[0][0].url).toBe('http://localhost:3000/webhook');
  });

  it('accepts http://127.0.0.1 for local testing', async () => {
    await createEndpoint('user-1', 'http://127.0.0.1:8080/webhook', ['invoice.failed']);

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate.mock.calls[0][0].url).toBe('http://127.0.0.1:8080/webhook');
  });

  it('rejects invalid event names', async () => {
    await expect(
      createEndpoint('user-1', 'https://example.com/hook', ['invoice.completed', 'not.real']),
    ).rejects.toThrow(/Invalid webhook events: not\.real/);

    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('isAllowedWebhookUrl (via createEndpoint URL policy)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockImplementation(async (doc) => doc);
  });

  it.each([
    ['development', 'http://localhost:4000/hook'],
    ['production', 'http://localhost:4000/hook'],
  ])('allows localhost http URLs in %s', async (nodeEnv, url) => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = nodeEnv;
    try {
      await expect(createEndpoint('user-1', url, ['invoice.completed'])).resolves.toBeDefined();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it.each([
    ['development', 'http://192.168.0.5/hook'],
    ['production', 'http://192.168.0.5/hook'],
  ])('rejects non-localhost http URLs in %s', async (nodeEnv, url) => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = nodeEnv;
    try {
      await expect(createEndpoint('user-1', url, ['invoice.completed'])).rejects.toThrow(ValidationError);
      expect(mockCreate).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});

describe('toggleEndpoint ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows the owner to toggle their endpoint', async () => {
    mockGet.mockResolvedValue(makeEndpoint({ user_id: 'user-1' }));

    await toggleEndpoint('ep-1', 'user-1', false);

    expect(mockUpdate).toHaveBeenCalledWith('ep-1', { active: false });
  });

  it('rejects toggle when endpoint belongs to another user', async () => {
    mockGet.mockResolvedValue(makeEndpoint({ user_id: 'other-user' }));

    await expect(toggleEndpoint('ep-1', 'user-1', true)).rejects.toThrow(NotFoundError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('rejects toggle when endpoint does not exist', async () => {
    mockGet.mockResolvedValue(null);

    await expect(toggleEndpoint('missing', 'user-1', true)).rejects.toThrow(NotFoundError);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('removeEndpoint ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows the owner to delete their endpoint', async () => {
    mockGet.mockResolvedValue(makeEndpoint({ user_id: 'user-1' }));

    await removeEndpoint('ep-1', 'user-1');

    expect(mockDelete).toHaveBeenCalledWith('ep-1');
  });

  it('rejects delete when endpoint belongs to another user', async () => {
    mockGet.mockResolvedValue(makeEndpoint({ user_id: 'other-user' }));

    await expect(removeEndpoint('ep-1', 'user-1')).rejects.toThrow(NotFoundError);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('rejects delete when endpoint does not exist', async () => {
    mockGet.mockResolvedValue(null);

    await expect(removeEndpoint('missing', 'user-1')).rejects.toThrow(NotFoundError);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
