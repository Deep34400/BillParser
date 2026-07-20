import { describe, it, expect } from 'vitest';
import { resolveGeminiVertexLocation } from '../../src/providers/geminiClient.js';

describe('resolveGeminiVertexLocation', () => {
  it('routes ALL Gemini models to the global endpoint (ADC)', () => {
    expect(resolveGeminiVertexLocation('gemini-3.1-flash-lite')).toBe('global');
    expect(resolveGeminiVertexLocation('gemini-3.5-flash')).toBe('global');
    expect(resolveGeminiVertexLocation('gemini-3.1-pro-preview')).toBe('global');
    expect(resolveGeminiVertexLocation('gemini-3-flash-preview')).toBe('global');
    expect(resolveGeminiVertexLocation('gemini-flash-latest')).toBe('global');
    expect(resolveGeminiVertexLocation('gemini-2.5-flash')).toBe('global');
    expect(resolveGeminiVertexLocation('gemini-2.5-pro')).toBe('global');
    expect(resolveGeminiVertexLocation('gemini-2.5-flash-lite')).toBe('global');
  });
});
