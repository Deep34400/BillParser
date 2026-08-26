/**
 * The billing rule, pinned.
 *
 * This logic previously existed in three copies (geminiClient, llmSingle,
 * llmNormalize) and they had already drifted — only some applied the
 * long-context tier, so the single-mode path (the one actually in use) billed
 * large prompts at the small-prompt rate. Now one implementation; these tests
 * guard it.
 */
import { describe, it, expect } from 'vitest';
import { computeLlmCost, resolveModelPricing } from '../../../src/shared/modelPricing.js';

describe('computeLlmCost', () => {
  it('bills input and output at the model rate', () => {
    const c = computeLlmCost({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, 'gemini-2.5-flash');
    expect(c.input_cost_usd).toBeCloseTo(0.30, 6);
    expect(c.output_cost_usd).toBeCloseTo(2.50, 6);
    expect(c.cost_usd).toBeCloseTo(2.80, 6);
  });

  it('bills thinking tokens at the OUTPUT rate, not input and not free', () => {
    const noThink = computeLlmCost({ prompt_tokens: 1000, completion_tokens: 1000 }, 'gemini-2.5-flash');
    const withThink = computeLlmCost(
      { prompt_tokens: 1000, completion_tokens: 1000, thinking_tokens: 1000 },
      'gemini-2.5-flash',
    );
    // One extra 1k of thinking costs exactly one extra 1k of output.
    expect(withThink.cost_usd - noThink.cost_usd).toBeCloseTo(1000 * 2.50 / 1_000_000, 8);
    expect(withThink.input_cost_usd).toBe(noThink.input_cost_usd);
  });

  it('reports the rates it used, so the cost can be re-derived', () => {
    const c = computeLlmCost({ prompt_tokens: 2217, completion_tokens: 581, thinking_tokens: 988 }, 'gemini-2.5-flash');
    expect(c.input_rate_per_1m).toBe(0.30);
    expect(c.output_rate_per_1m).toBe(2.50);
    // tokens × rate = cost — the property that makes a stored figure auditable
    expect(2217 * c.input_rate_per_1m / 1_000_000).toBeCloseTo(c.input_cost_usd, 9);
    expect((581 + 988) * c.output_rate_per_1m / 1_000_000).toBeCloseTo(c.output_cost_usd, 9);
  });

  it('reproduces a real invoice end to end', () => {
    const c = computeLlmCost({ prompt_tokens: 2217, completion_tokens: 581, thinking_tokens: 988 }, 'gemini-2.5-flash');
    expect(c.cost_usd).toBeCloseTo(0.0045876, 7);
  });

  it('applies the long-context tier above the threshold', () => {
    const under = computeLlmCost({ prompt_tokens: 100_000, completion_tokens: 1000 }, 'gemini-2.5-pro');
    const over = computeLlmCost({ prompt_tokens: 300_000, completion_tokens: 1000 }, 'gemini-2.5-pro');
    expect(under.input_rate_per_1m).toBe(1.25);
    expect(over.input_rate_per_1m).toBe(2.50);
    expect(over.output_rate_per_1m).toBe(15);
  });

  it('keeps a flat rate for models without a tier', () => {
    const over = computeLlmCost({ prompt_tokens: 300_000, completion_tokens: 1000 }, 'gemini-2.5-flash');
    expect(over.input_rate_per_1m).toBe(0.30);
  });

  it('honours a Settings override ahead of the built-in rate', () => {
    const c = computeLlmCost(
      { prompt_tokens: 1_000_000, completion_tokens: 0 },
      'gemini-2.5-flash',
      { 'gemini-2.5-flash': { inputPer1M: 9.99, outputPer1M: 1 } },
    );
    expect(c.input_rate_per_1m).toBe(9.99);
    expect(c.input_cost_usd).toBeCloseTo(9.99, 6);
  });

  it('over- rather than under-states an unknown model', () => {
    const unknown = computeLlmCost({ prompt_tokens: 1_000_000, completion_tokens: 0 }, 'some-model-we-never-heard-of');
    const flash = computeLlmCost({ prompt_tokens: 1_000_000, completion_tokens: 0 }, 'gemini-2.5-flash');
    expect(unknown.input_cost_usd).toBeGreaterThan(flash.input_cost_usd);
  });

  it('no longer resolves floating aliases — they cannot be priced honestly', () => {
    // gemini-flash-latest was aliased to 3.5-flash rates; Google can repoint it.
    const aliased = resolveModelPricing('gemini-flash-latest');
    const proFallback = resolveModelPricing('gemini-2.5-pro');
    expect(aliased).toEqual(proFallback);
  });

  it('charges nothing for a call that produced no tokens', () => {
    const c = computeLlmCost({ prompt_tokens: 0, completion_tokens: 0 }, 'gemini-2.5-flash');
    expect(c.cost_usd).toBe(0);
  });
});
