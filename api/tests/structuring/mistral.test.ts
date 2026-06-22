import { it, expect, vi, afterEach } from 'vitest';
import { mistralStructModel } from '../../src/structuring/mistral.js';

afterEach(() => vi.restoreAllMocks());

it('returns the structuring cost computed from token usage', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({
      choices: [{ message: { content: '{"lineItems":[]}' } }],
      usage: { prompt_tokens: 5698, completion_tokens: 3603 },
    }), { status: 200 }),
  ));
  const r = await mistralStructModel('mistral-large-latest').structure('# md', { apiKey: 'k' });
  // mistral-large-latest = [$2,$6]/1M -> (5698*2 + 3603*6)/1e6
  expect(r.structuringCost).toBeCloseTo((5698 * 2 + 3603 * 6) / 1e6, 9);
});

it('surfaces the Mistral error body in the thrown message, not just the status', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ message: 'Invalid model: qwen2.5:3b', type: 'invalid_model' }), { status: 400 }),
  ));
  await expect(
    mistralStructModel('qwen2.5:3b').structure('# md', { apiKey: 'k' }),
  ).rejects.toThrow(/Invalid model: qwen2\.5:3b/);
});
