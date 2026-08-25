import { describe, expect, it } from 'vitest';
import { getSettings, saveSettings } from '../../../src/shared/settings.js';
import { GEMINI_SINGLE_FALLBACK_MODEL } from '../../../src/ocr/process.js';

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

  it('fallback model is gemini-2.5-flash single (never split)', () => {
    expect(GEMINI_SINGLE_FALLBACK_MODEL).toBe('gemini-2.5-flash');
  });

  it('saveSettings updates pipelineMode', async () => {
    await saveSettings({ pipelineMode: 'split' });
    expect((await getSettings()).pipelineMode).toBe('split');
    await saveSettings({ pipelineMode: 'single' });
  });
});
