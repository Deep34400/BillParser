import type { ExtractionProvider } from './types.js';
export const textractProvider: ExtractionProvider = {
  name: 'textract', displayName: 'AWS Textract', kind: 'structured',
  requiredCredentials: ['accessKeyId', 'secretAccessKey', 'region'],
  isConfigured: (c) => !!c?.accessKeyId && !!c?.secretAccessKey && !!c?.region,
  async extract() { throw new Error('not implemented yet'); },
};
