import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildFallbackChain, type FallbackLevel, type AppSettings } from '../../../src/shared/settings.js';

describe('buildFallbackChain', () => {
  const base: AppSettings = {
    pipelineMode: 'single',
    extractionProvider: 'mistral',
    structuringProvider: 'gemini',
    structuringModel: 'gemini-2.5-flash',
    singleProvider: 'gemini',
    singleModel: 'gemini-2.5-flash',
  };

  it('returns fallbackChain when present and has enabled levels', () => {
    const chain: FallbackLevel[] = [
      { label: 'Primary', mode: 'single', provider: 'claude', model: 'claude-sonnet-4-20250514', enabled: true },
      { label: 'Secondary', mode: 'single', provider: 'gemini', model: 'gemini-2.5-flash', enabled: true },
    ];
    const result = buildFallbackChain({ ...base, fallbackChain: chain });
    expect(result).toEqual(chain);
  });

  it('filters to only enabled levels', () => {
    const chain: FallbackLevel[] = [
      { label: 'Primary', mode: 'single', provider: 'claude', model: 'claude-sonnet-4-20250514', enabled: false },
      { label: 'Secondary', mode: 'single', provider: 'gemini', model: 'gemini-2.5-flash', enabled: true },
    ];
    const result = buildFallbackChain({ ...base, fallbackChain: chain });
    expect(result).toHaveLength(1);
    expect(result[0].provider).toBe('gemini');
  });

  it('falls back to legacy single settings when no chain', () => {
    const result = buildFallbackChain({ ...base, singleProvider: 'openai', singleModel: 'gpt-4o' });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      mode: 'single', provider: 'openai', model: 'gpt-4o', enabled: true,
    });
  });

  it('falls back to legacy split settings when no chain', () => {
    const result = buildFallbackChain({
      ...base, pipelineMode: 'split',
      structuringProvider: 'claude', structuringModel: 'claude-3-haiku-20240307',
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      mode: 'split', provider: 'mistral',
      structuringProvider: 'claude', structuringModel: 'claude-3-haiku-20240307',
      enabled: true,
    });
  });

  it('falls back to legacy when chain is empty array', () => {
    const result = buildFallbackChain({ ...base, fallbackChain: [] });
    expect(result).toHaveLength(1);
    expect(result[0].provider).toBe('gemini');
  });

  it('falls back to legacy when all chain levels disabled', () => {
    const chain: FallbackLevel[] = [
      { label: 'Primary', mode: 'single', provider: 'claude', model: 'claude-sonnet-4-20250514', enabled: false },
    ];
    const result = buildFallbackChain({ ...base, fallbackChain: chain });
    expect(result).toHaveLength(1);
    expect(result[0].provider).toBe('gemini');
  });
});
