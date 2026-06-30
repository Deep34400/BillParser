import { describe, it, expect } from 'vitest';
import { allProviders, getProvider } from '../../src/providers/registry.js';
it('registers all six providers', () => {
  expect(allProviders().map((p) => p.name).sort()).toEqual(['azure', 'gemini', 'google', 'llamaparse', 'mistral', 'ollama', 'textract']);
});
it('looks up by name and throws on unknown', () => {
  expect(getProvider('mistral').displayName).toBe('Mistral OCR');
  expect(() => getProvider('nope')).toThrow();
});
