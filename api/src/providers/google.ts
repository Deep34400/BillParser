import type { ExtractionProvider } from './types.js';
export const googleProvider: ExtractionProvider = {
  name: 'google', displayName: 'Google Document AI', kind: 'structured',
  requiredCredentials: ['projectId', 'location', 'processorId', 'keyJson'],
  isConfigured: (c) => !!c?.projectId && !!c?.processorId && !!c?.keyJson,
  async extract() { throw new Error('Google Document AI provider is not implemented yet'); },
};
