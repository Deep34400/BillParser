/**
 * Parser types — shapes returned by the parsing layer.
 */
import type { ParsedInvoiceData } from '../../shared/types.js';

export interface InvoiceSchemaEntry {
  id?: string;
  parsed_data?: Record<string, unknown>;
}

export interface InvoiceSchemaOutput {
  output: {
    entries?: InvoiceSchemaEntry[];
  };
}

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ParseResult {
  parsed: ParsedInvoiceData;
  raw: Record<string, unknown>;
  format: 'schema' | 'legacy';
  validation: ValidationIssue[];
}
