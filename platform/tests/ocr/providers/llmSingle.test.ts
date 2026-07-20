import { describe, it, expect } from 'vitest';
import { SINGLE_PROVIDERS, llmSingle } from '../../../src/ocr/providers/llmSingle.js';

describe('llmSingle providers', () => {
  it('supports gemini, claude, openai, mistral', () => {
    expect(SINGLE_PROVIDERS).toEqual(['gemini', 'claude', 'openai', 'mistral']);
  });

  it('rejects unknown provider', async () => {
    await expect(llmSingle(Buffer.from('x'), 'unknown')).rejects.toThrow(/does not support/);
  });

  it('rejects OpenAI single for PDF', async () => {
    const pdf = Buffer.from('%PDF-1.4 fake');
    const { devStore } = await import('../../../src/shared/devStore.js');
    devStore.saveCreds('openai', { apiKey: 'sk-test' });
    await expect(llmSingle(pdf, 'openai')).rejects.toThrow(/images only/);
  });

  it('does not reject Mistral single for PDF with images-only error', async () => {
    const pdf = Buffer.from('%PDF-1.4 fake');
    const { devStore } = await import('../../../src/shared/devStore.js');
    devStore.saveCreds('mistral', { apiKey: 'sk-test' });
    // Will fail on real API, but must NOT be the old "images only" message
    await expect(llmSingle(pdf, 'mistral')).rejects.not.toThrow(/images only/);
  });
});
