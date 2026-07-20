import { parseStructuredOutput } from './parse.js';
import type { ParsedInvoiceData } from './types.js';

export { parseStructuredOutput, coerceParsedInvoiceData } from './parse.js';

/**
 * Bridge function — used by providers to convert LLM text → ParsedInvoiceData.
 */
export function structureFromLlmResponse(
  text: string,
  rawOcr?: string,
): { parsedData: ParsedInvoiceData | null; error?: string } {
  try {
    const result = parseStructuredOutput(text, rawOcr);
    return { parsedData: result.parsed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[parse] structureFromLlmResponse failed: ${msg.slice(0, 200)} | raw[0..200]=${(text ?? '').slice(0, 200)}`);
    return { parsedData: null, error: msg };
  }
}
