import { describe, it, expect, beforeEach } from 'vitest';
import { resolveProviderKey } from '../../../src/ocr/providers/resolveKey.js';
import { estimateGeminiCostUsd } from '../../../src/ocr/providers/geminiClient.js';
import { clearProviderCredentials, saveProviderCredentials } from '../../../src/shared/settings.js';

describe('resolveProviderKey', () => {
  beforeEach(async () => {
    for (const p of ['mistral', 'gemini', 'claude', 'openai']) {
      await clearProviderCredentials(p);
    }
  });

  it('throws for non-Gemini providers without a key', async () => {
    await expect(resolveProviderKey('claude')).rejects.toThrow(/No API key for claude/);
  });

  it('Gemini always uses ADC even when an API key is stored', async () => {
    await saveProviderCredentials('gemini', { apiKey: 'test-gemini-key', model: 'gemini-2.5-pro' });
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
  // gemini-2.5-flash: $0.30/1M in, $2.50/1M out (ai.google.dev, Aug 2026)
  it('computes cost from token usage', () => {
    const cost = estimateGeminiCostUsd({ prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 }, 'gemini-2.5-flash');
    // Returns a CostBreakdown, not a bare number — assert the field, or
    // toBeCloseTo compares an object to a number and yields NaN.
    expect(cost.cost_usd).toBeCloseTo(0.0003 + 0.0025, 6);
    expect(cost.input_cost_usd).toBeCloseTo(0.0003, 6);
    expect(cost.output_cost_usd).toBeCloseTo(0.0025, 6);
  });

  it('bills thinking tokens at the output rate', () => {
    const cost = estimateGeminiCostUsd(
      { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 3000, thinking_tokens: 1000 },
      'gemini-2.5-flash',
    );
    // 2000 billable output tokens, not 1000
    expect(cost.output_cost_usd).toBeCloseTo(0.005, 6);
    expect(cost.cost_usd).toBeCloseTo(0.0003 + 0.005, 6);
  });

  it('reproduces the per-invoice figure shown in the UI', () => {
    // Real run: 2,217 prompt / 581 answer + 988 thinking
    const cost = estimateGeminiCostUsd(
      { prompt_tokens: 2217, completion_tokens: 581, total_tokens: 3786, thinking_tokens: 988 },
      'gemini-2.5-flash',
    );
    expect(cost.cost_usd).toBeCloseTo(0.0045876, 7);
  });

  it('applies the >200k long-context tier on models that have one', () => {
    const under = estimateGeminiCostUsd({ prompt_tokens: 100_000, completion_tokens: 1000, total_tokens: 101_000 }, 'gemini-2.5-pro');
    const over = estimateGeminiCostUsd({ prompt_tokens: 300_000, completion_tokens: 1000, total_tokens: 301_000 }, 'gemini-2.5-pro');
    expect(under.input_cost_usd).toBeCloseTo(100_000 * 1.25 / 1_000_000, 6);  // base rate
    expect(over.input_cost_usd).toBeCloseTo(300_000 * 2.50 / 1_000_000, 6);   // doubled
    expect(over.output_cost_usd).toBeCloseTo(1000 * 15.0 / 1_000_000, 6);
  });

  it('keeps the flat rate for models without a long-context tier', () => {
    const over = estimateGeminiCostUsd({ prompt_tokens: 300_000, completion_tokens: 1000, total_tokens: 301_000 }, 'gemini-2.5-flash');
    expect(over.input_cost_usd).toBeCloseTo(300_000 * 0.30 / 1_000_000, 6);
  });
});
