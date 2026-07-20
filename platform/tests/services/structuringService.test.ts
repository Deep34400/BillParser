import { describe, expect, it } from 'vitest';
import { devStore } from '../../src/lib/devStore.js';

describe('pipeline settings from devStore', () => {
  it('default pipelineMode is single', () => {
    const s = devStore.getSettings();
    expect(s.pipelineMode).toBe('single');
  });

  it('default extraction provider is mistral', () => {
    const s = devStore.getSettings();
    expect(s.extractionProvider).toBe('mistral');
  });

  it('default structuring / single provider is gemini', () => {
    const s = devStore.getSettings();
    expect(s.structuringProvider).toBe('gemini');
    expect(s.singleProvider).toBe('gemini');
    expect(s.singleModel).toBe('gemini-2.5-flash');
  });

  it('saveSettings updates pipelineMode', () => {
    devStore.saveSettings({ pipelineMode: 'split' });
    expect(devStore.getSettings().pipelineMode).toBe('split');
    devStore.saveSettings({ pipelineMode: 'single' });
  });
});
