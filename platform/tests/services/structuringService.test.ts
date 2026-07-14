import { describe, expect, it, afterEach, vi } from 'vitest';

describe('resolveStructuringProvider', () => {
  const orig = process.env.NORMALIZE_PROVIDER;

  afterEach(() => {
    if (orig === undefined) delete process.env.NORMALIZE_PROVIDER;
    else process.env.NORMALIZE_PROVIDER = orig;
    vi.resetModules();
  });

  it('uses NORMALIZE_PROVIDER env when set to gemini', async () => {
    process.env.NORMALIZE_PROVIDER = 'gemini';
    vi.resetModules();
    const { resolveStructuringProvider } = await import('../../src/services/billing/structuringService.js');
    await expect(resolveStructuringProvider()).resolves.toBe('gemini');
  });

  it('uses NORMALIZE_PROVIDER env when set to mistral', async () => {
    process.env.NORMALIZE_PROVIDER = 'mistral';
    vi.resetModules();
    const { resolveStructuringProvider } = await import('../../src/services/billing/structuringService.js');
    await expect(resolveStructuringProvider()).resolves.toBe('mistral');
  });
});
