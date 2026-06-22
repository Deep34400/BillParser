import { it, expect } from 'vitest';
import { structuringTokenCost } from '../../src/structuring/pricing.js';

it('prices a known model from input/output token usage (USD)', () => {
  // mistral-large-latest = [$2, $6] per 1M tokens
  // 1,000,000 in + 1,000,000 out => $2 + $6 = $8
  expect(structuringTokenCost('mistral-large-latest', 1_000_000, 1_000_000)).toBeCloseTo(8, 6);
  // realistic small call
  expect(structuringTokenCost('mistral-large-latest', 5698, 3603)).toBeCloseTo((5698 * 2 + 3603 * 6) / 1e6, 9);
});

it('returns 0 for unknown/local models (cannot be priced)', () => {
  expect(structuringTokenCost('qwen2.5:3b', 1000, 1000)).toBe(0);
  expect(structuringTokenCost('glm-ocr', 1000, 1000)).toBe(0);
});

it('returns 0 when token counts are missing', () => {
  expect(structuringTokenCost('mistral-large-latest', 0, 0)).toBe(0);
  expect(structuringTokenCost('mistral-large-latest', undefined, undefined)).toBe(0);
});
