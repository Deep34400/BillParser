import { describe, expect, it } from 'vitest';
import { devStore } from '../../src/lib/devStore.js';

describe('pipeline settings from devStore', () => {
  it('default pipelineMode is split', () => {
    const s = devStore.getSettings();
    expect(s.pipelineMode).toBe('split');
  });

  it('default extraction provider is mistral', () => {
    const s = devStore.getSettings();
    expect(s.extractionProvider).toBe('mistral');
  });

  it('default structuring provider is gemini', () => {
    const s = devStore.getSettings();
    expect(s.structuringProvider).toBe('gemini');
  });

  it('saveSettings updates pipelineMode', () => {
    devStore.saveSettings({ pipelineMode: 'single' });
    expect(devStore.getSettings().pipelineMode).toBe('single');
    devStore.saveSettings({ pipelineMode: 'split' });
  });
});
