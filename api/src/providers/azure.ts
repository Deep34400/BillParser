import type { ExtractionProvider } from './types.js';
export const azureProvider: ExtractionProvider = {
  name: 'azure', displayName: 'Azure Document Intelligence', kind: 'structured',
  requiredCredentials: ['endpoint', 'apiKey'],
  isConfigured: (c) => !!c?.endpoint && !!c?.apiKey,
  async extract() { throw new Error('not implemented yet'); },
};
