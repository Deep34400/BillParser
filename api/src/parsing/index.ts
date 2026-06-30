/**
 * Central invoice parsing module.
 *
 * Change accuracy here:
 *   parsing/prompt.ts   — OCR + structuring prompts
 *   parsing/types.ts    — JSON field definitions
 *   parsing/validate.ts — business validation rules
 *
 * Pipeline: OCR markdown → LLM → parse → validate → toCanonical → DB
 */
export type {
  ParsedInvoiceData, InvoiceSchemaOutput, PartsLineItem, LabourServiceLineItem,
  ServiceDetails, VehicleDetails, TotalsAndTaxSummary, ValidationIssue, ParseResult,
} from './types.js';

export { OCR_PROMPT, OCR_HEADER_PROMPT, STRUCTURING_PROMPT, SCHEMA_JSON_EXAMPLE } from './prompt.js';
export { parseStructuredOutput } from './parse.js';
export { validateParsedInvoice, hasValidationErrors } from './validate.js';
export { toCanonicalResult, wrapParsedData, parseLegacyCanonical } from '../response/toCanonical.js';
export { parseInvoiceDate, extractJsonObject, prepareLlmJson } from './coerce.js';

import type { CanonicalResult } from '../providers/types.js';
import { parseStructuredOutput } from './parse.js';
import { toCanonicalResult, wrapParsedData, parseLegacyCanonical } from '../response/toCanonical.js';
import { hasValidationErrors } from './validate.js';
import { prepareLlmJson } from './coerce.js';

/** LLM text → canonical fields + parsed_data for DB storage. */
export function structureFromLlmResponse(
  raw: string,
  markdown?: string,
  structuringCost = 0,
): Omit<CanonicalResult, 'rawText' | 'rawJson'> {
  const result = parseStructuredOutput(raw, markdown);
  if (result.format === 'legacy') {
    return { ...parseLegacyCanonical(prepareLlmJson(raw), markdown), parsedData: null, structuringCost };
  }
  if (hasValidationErrors(result.validation)) {
    console.warn('[invoice-schema] validation errors:', result.validation.filter((v) => v.severity === 'error'));
  } else if (result.validation.length) {
    console.warn('[invoice-schema] validation warnings:', result.validation);
  }
  return { ...toCanonicalResult(result.parsed, markdown), parsedData: result.parsed, structuringCost };
}

/** @deprecated use structureFromLlmResponse — kept for tests */
export function normalizeStructured(raw: string, markdown?: string): Omit<CanonicalResult, 'rawText' | 'rawJson'> {
  const r = structureFromLlmResponse(raw, markdown, 0);
  const { structuringCost: _, ...rest } = r;
  return rest;
}

/** Full parsed schema + wrapper for rawJson storage. */
export function structureMarkdown(raw: string, markdown?: string) {
  const result = parseStructuredOutput(raw, markdown);
  return {
    canonical: toCanonicalResult(result.parsed, markdown),
    parsed: result.parsed,
    schemaOutput: wrapParsedData(result.parsed),
    validation: result.validation,
    format: result.format,
  };
}
