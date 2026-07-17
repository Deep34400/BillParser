/**
 * Gemini single-prompt mode — thin wrapper around llmSingle.
 * Kept for any direct imports; prefer llmSingle for new code.
 */
import { llmSingle, type SingleResult } from './llmSingle.js';

export type GeminiSingleResult = SingleResult;

export async function geminiSingle(buf: Buffer): Promise<GeminiSingleResult> {
  return llmSingle(buf, 'gemini');
}
