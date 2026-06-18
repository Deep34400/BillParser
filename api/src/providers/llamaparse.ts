import type { ExtractionProvider } from './types.js';
export const llamaparseProvider: ExtractionProvider = {
  name: 'llamaparse', displayName: 'LlamaParse', kind: 'markdown',
  requiredCredentials: ['apiKey'],
  isConfigured: (c) => !!c?.apiKey,
  async extract() { throw new Error('not implemented yet'); },
};
