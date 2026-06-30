import type { CanonicalResult } from '../providers/types.js';
export interface StructuringModel {
  provider: string; model: string;
  structure(markdown: string, creds: Record<string, string>): Promise<Omit<CanonicalResult, 'rawText' | 'rawJson'>>;
}
export { STRUCTURING_PROMPT } from '../parsing/prompt.js';
