import { describe, it, expect, beforeEach } from 'vitest';
import { resolveProviderKey } from '../../../src/ocr/providers/resolveKey.js';
import { estimateGeminiCostUsd } from '../../../src/ocr/providers/geminiClient.js';
import { devStore } from '../../../src/shared/devStore.js';

describe('resolveProviderKey', () => {
  beforeEach(() => {
    for (const p of ['mistral', 'gemini', 'claude', 'openai']) {
      devStore.clearCreds(p);
    }
  });

  it('throws for non-Gemini providers without a key', async () => {
    await expect(resolveProviderKey('claude')).rejects.toThrow(/No API key for claude/);
  });

  it('Gemini always uses ADC even when an API key is stored', async () => {
    devStore.saveCreds('gemini', { apiKey: 'test-gemini-key', model: 'gemini-2.5-pro' });
    const g = await resolveProviderKey('gemini');
    expect(g.apiKey).toBe('');
    expect(g.useAdc).toBe(true);
    expect(g.model).toBe('gemini-2.5-pro');
  });

  it('Gemini uses model override from Settings selection', async () => {
    const g = await resolveProviderKey('gemini', 'gemini-3.1-pro-preview');
    expect(g.apiKey).toBe('');
    expect(g.useAdc).toBe(true);
    expect(g.model).toBe('gemini-3.1-pro-preview');
  });
});

describe('estimateGeminiCostUsd', () => {
  it('computes cost from token usage', () => {
    const cost = estimateGeminiCostUsd({ prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 }, 'gemini-2.5-flash');
    expect(cost).toBeCloseTo(0.0003 + 0.0025, 6);
  });
});
