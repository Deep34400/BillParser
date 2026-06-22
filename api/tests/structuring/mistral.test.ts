import { it, expect, vi, afterEach } from 'vitest';
import { mistralStructModel } from '../../src/structuring/mistral.js';

afterEach(() => vi.restoreAllMocks());

it('surfaces the Mistral error body in the thrown message, not just the status', async () => {
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ message: 'Invalid model: qwen2.5:3b', type: 'invalid_model' }), { status: 400 }),
  ));
  await expect(
    mistralStructModel('qwen2.5:3b').structure('# md', { apiKey: 'k' }),
  ).rejects.toThrow(/Invalid model: qwen2\.5:3b/);
});
