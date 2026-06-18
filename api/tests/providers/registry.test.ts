import { describe, it, expect } from 'vitest';
import { allProviders, getProvider } from '../../src/providers/registry.js';
it('registers all five providers', () => {
  expect(allProviders().map((p) => p.name).sort()).toEqual(['azure', 'google', 'llamaparse', 'mistral', 'textract']);
});
it('looks up by name and throws on unknown', () => {
  expect(getProvider('mistral').displayName).toBe('Mistral OCR');
  expect(() => getProvider('nope')).toThrow();
});
