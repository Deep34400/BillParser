import type { ExtractionProvider } from './types.js';
import { mistralProvider } from './mistral.js';
import { azureProvider } from './azure.js';
import { llamaparseProvider } from './llamaparse.js';
import { textractProvider } from './textract.js';
import { googleProvider } from './google.js';
import { geminiProvider } from './gemini.js';
import { ollamaProvider } from './ollama.js';

const REGISTRY: ExtractionProvider[] = [mistralProvider, azureProvider, llamaparseProvider, textractProvider, googleProvider, geminiProvider, ollamaProvider];
export const allProviders = (): ExtractionProvider[] => REGISTRY;
export function getProvider(name: string): ExtractionProvider {
  const p = REGISTRY.find((x) => x.name === name);
  if (!p) throw new Error(`Unknown provider: ${name}`);
  return p;
}
