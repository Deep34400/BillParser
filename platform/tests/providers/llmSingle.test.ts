import { describe, it, expect } from 'vitest';
import { SINGLE_PROVIDERS, llmSingle } from '../../src/providers/llmSingle.js';

describe('llmSingle providers', () => {
  it('supports gemini, claude, openai, mistral', () => {
    expect(SINGLE_PROVIDERS).toEqual(['gemini', 'claude', 'openai', 'mistral']);
  });

  it('rejects unknown provider', async () => {
    await expect(llmSingle(Buffer.from('x'), 'unknown')).rejects.toThrow(/does not support/);
  });

  it('rejects OpenAI single for PDF', async () => {
    const pdf = Buffer.from('%PDF-1.4 fake');
    // Will fail on key or PDF check — PDF check comes after resolveKey which needs key
    // Save a fake key so we hit the PDF validation
    const { devStore } = await import('../../src/lib/devStore.js');
    devStore.saveCreds('openai', { apiKey: 'sk-test' });
    await expect(llmSingle(pdf, 'openai')).rejects.toThrow(/images only/);
  });
});
