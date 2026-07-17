import { describe, it, expect, beforeEach } from 'vitest';
import { resolveProviderKey } from '../../src/providers/resolveKey.js';
import { estimateGeminiCostUsd } from '../../src/providers/geminiClient.js';
import { devStore } from '../../src/lib/devStore.js';

describe('resolveProviderKey', () => {
  beforeEach(() => {
    for (const p of ['mistral', 'gemini', 'claude', 'openai']) {
      devStore.clearCreds(p);
    }
  });

  it('throws for non-Gemini providers without a key', async () => {
    await expect(resolveProviderKey('claude')).rejects.toThrow(/No API key for claude/);
  });

  it('returns useAdc=false when Gemini API key is in DB', async () => {
    devStore.saveCreds('gemini', { apiKey: 'test-gemini-key' });
    const g = await resolveProviderKey('gemini');
    expect(g.apiKey).toBe('test-gemini-key');
    expect(g.useAdc).toBe(false);
  });

  it('allows Gemini with empty key (ADC / Vertex mode)', async () => {
    // Clear DB key; env may still provide a key — either way must not throw
    const g = await resolveProviderKey('gemini');
    expect(g.model).toBeTruthy();
    expect(g.useAdc).toBe(!g.apiKey);
  });
});

describe('estimateGeminiCostUsd', () => {
  it('computes cost from token usage', () => {
    const cost = estimateGeminiCostUsd({ prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 });
    expect(cost).toBeCloseTo(0.00015 + 0.0006, 6);
  });
});
