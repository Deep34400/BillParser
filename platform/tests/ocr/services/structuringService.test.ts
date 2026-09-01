import { describe, expect, it } from 'vitest';
import { getSettings, saveSettings } from '../../../src/shared/settings.js';

describe('pipeline settings', () => {
  it('default pipelineMode is single', async () => {
    const s = await getSettings();
    expect(s.pipelineMode).toBe('single');
  });

  it('default extraction provider is mistral', async () => {
    const s = await getSettings();
    expect(s.extractionProvider).toBe('mistral');
  });

  it('default structuring / single provider is gemini', async () => {
    const s = await getSettings();
    expect(s.structuringProvider).toBe('gemini');
    expect(s.singleProvider).toBe('gemini');
    expect(s.singleModel).toBe('gemini-2.5-flash');
  });


  it('saveSettings updates pipelineMode', async () => {
    await saveSettings({ pipelineMode: 'split' });
    expect((await getSettings()).pipelineMode).toBe('split');
    await saveSettings({ pipelineMode: 'single' });
  });
});

describe('buildFallbackChain', () => {
  it('derives a single level from the legacy pipeline settings', async () => {
    // Settings gained an explicit fallbackChain; with none configured it must
    // still yield the legacy single-provider behaviour.
    const { buildFallbackChain } = await import('../../../src/shared/settings.js');
    const chain = buildFallbackChain({
      pipelineMode: 'single',
      extractionProvider: 'mistral',
      structuringProvider: 'gemini',
      structuringModel: 'gemini-2.5-flash',
      singleProvider: 'gemini',
      singleModel: 'gemini-2.5-flash',
    });
    expect(chain).toHaveLength(1);
    expect(chain[0]).toMatchObject({ mode: 'single', provider: 'gemini', model: 'gemini-2.5-flash' });
  });
});
