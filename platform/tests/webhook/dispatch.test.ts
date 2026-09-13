import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

vi.mock('../../src/webhook/repository.js', () => ({
  findActiveWebhooksForEvent: vi.fn(),
}));

vi.mock('../../src/webhook/models/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/webhook/models/index.js')>();
  return {
    ...actual,
    WebhookDelivery: { create: vi.fn().mockResolvedValue({}) },
  };
});

import { dispatchWebhookEvent } from '../../src/webhook/service.js';
import { findActiveWebhooksForEvent } from '../../src/webhook/repository.js';
import type { WebhookEndpointDoc } from '../../src/webhook/repository.js';

const mockFindActive = vi.mocked(findActiveWebhooksForEvent);

function makeEndpoint(overrides: Partial<WebhookEndpointDoc> = {}): WebhookEndpointDoc {
  return {
    endpoint_id: 'ep-1',
    user_id: 'user-1',
    url: 'https://example.com/webhook',
    events: ['invoice.completed'],
    secret: 'whsec_testsecret123',
    active: true,
    description: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('dispatchWebhookEvent', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({ ok: true, text: async () => '' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to active endpoints with correct payload and headers', async () => {
    const endpoint = makeEndpoint();
    mockFindActive.mockResolvedValue([endpoint]);

    dispatchWebhookEvent('user-1', 'invoice.completed', { billId: 'bill-42', status: 'OCR_COMPLETED' });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(endpoint.url);
    expect(opts.method).toBe('POST');
    expect(opts.headers).toMatchObject({
      'Content-Type': 'application/json',
      'X-Webhook-Event': 'invoice.completed',
    });

    const body = opts.body as string;
    const parsed = JSON.parse(body);
    expect(parsed.event).toBe('invoice.completed');
    expect(parsed.data).toEqual({ billId: 'bill-42', status: 'OCR_COMPLETED' });
    expect(parsed.id).toBeTruthy();
    expect(parsed.timestamp).toBeTruthy();

    const expectedSig = createHmac('sha256', endpoint.secret).update(body).digest('hex');
    expect((opts.headers as Record<string, string>)['X-Webhook-Signature']).toBe(`sha256=${expectedSig}`);
  });

  it('generates HMAC-SHA256 signature from the exact request body', async () => {
    const endpoint = makeEndpoint({ secret: 'whsec_signingkey' });
    mockFindActive.mockResolvedValue([endpoint]);

    dispatchWebhookEvent('user-1', 'invoice.failed', { reason: 'timeout' });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());

    const body = (mockFetch.mock.calls[0][1] as RequestInit).body as string;
    const signature = (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>;

    expect(signature['X-Webhook-Signature']).toBe(
      `sha256=${createHmac('sha256', 'whsec_signingkey').update(body).digest('hex')}`,
    );
  });

  it('does not throw when fetch fails', async () => {
    mockFindActive.mockResolvedValue([makeEndpoint()]);
    mockFetch.mockRejectedValue(new Error('network error'));

    expect(() =>
      dispatchWebhookEvent('user-1', 'invoice.completed', { billId: 'x' }),
    ).not.toThrow();

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
  });

  it('does not throw when endpoint lookup fails', async () => {
    mockFindActive.mockRejectedValue(new Error('db unavailable'));

    expect(() =>
      dispatchWebhookEvent('user-1', 'invoice.completed', { billId: 'x' }),
    ).not.toThrow();

    await vi.waitFor(() => expect(mockFindActive).toHaveBeenCalled());
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not call fetch for disabled endpoints (only active endpoints are returned)', async () => {
    const active = makeEndpoint({ endpoint_id: 'ep-active', url: 'https://active.example/hook' });
    mockFindActive.mockResolvedValue([active]);

    dispatchWebhookEvent('user-1', 'invoice.completed', { billId: 'b1' });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(mockFetch).toHaveBeenCalledWith('https://active.example/hook', expect.any(Object));
    expect(mockFindActive).toHaveBeenCalledWith('user-1', 'invoice.completed');
  });

  it('does not call fetch when no active subscribed endpoints exist', async () => {
    mockFindActive.mockResolvedValue([]);

    dispatchWebhookEvent('user-1', 'invoice.completed', { billId: 'b1' });

    await vi.waitFor(() => expect(mockFindActive).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('dispatches to multiple active endpoints', async () => {
    mockFindActive.mockResolvedValue([
      makeEndpoint({ endpoint_id: 'ep-1', url: 'https://a.example/hook' }),
      makeEndpoint({ endpoint_id: 'ep-2', url: 'https://b.example/hook' }),
    ]);

    dispatchWebhookEvent('user-1', 'invoice.approved', { billId: 'b2' });

    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(mockFetch.mock.calls.map((c) => c[0])).toEqual([
      'https://a.example/hook',
      'https://b.example/hook',
    ]);
  });
});
