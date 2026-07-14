import { parseStructuredOutput } from './parse.js';
import type { ParsedInvoiceData } from './types.js';

export { parseStructuredOutput, coerceParsedInvoiceData } from './parse.js';

/**
 * Bridge function — used by providers to convert LLM text → ParsedInvoiceData.
 */
export function structureFromLlmResponse(
  text: string,
  rawOcr?: string,
): { parsedData: ParsedInvoiceData | null } {
  try {
    const result = parseStructuredOutput(text, rawOcr);
    return { parsedData: result.parsed };
  } catch {
    return { parsedData: null };
  }
}
