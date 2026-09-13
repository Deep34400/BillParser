import { describe, it, expect } from 'vitest';
import { callVisionLlm, type VisionProviderConfig } from '../../../src/ocr/providers/visionCall.js';

const FAKE_CONFIG: VisionProviderConfig = {
  provider: 'test-provider',
  apiUrl: 'https://httpbin.org/status/500',
  buildHeaders: (key) => ({ 'content-type': 'application/json', authorization: `Bearer ${key}` }),
  buildBody: (model, _mime, _b64) => ({ model }),
  extractText: (json) => json.text ?? '',
  extractUsage: (json) => ({
    prompt_tokens: json.usage?.prompt_tokens ?? 0,
    completion_tokens: json.usage?.completion_tokens ?? 0,
    total_tokens: json.usage?.total_tokens ?? 0,
  }),
};

describe('callVisionLlm', () => {
  it('exports the function', () => {
    expect(typeof callVisionLlm).toBe('function');
  });

  it('throws on HTTP error with provider name in message', async () => {
    await expect(
      callVisionLlm(Buffer.from('test'), 'fake-key', 'test-model', FAKE_CONFIG),
    ).rejects.toThrow(/test-provider single HTTP/);
  });
});
