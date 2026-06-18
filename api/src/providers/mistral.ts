import type { ExtractionProvider } from './types.js';
export const mistralProvider: ExtractionProvider = {
  name: 'mistral', displayName: 'Mistral OCR', kind: 'markdown',
  requiredCredentials: ['apiKey'],
  isConfigured: (c) => !!c?.apiKey,
  async extract() { throw new Error('not implemented yet'); },
};
