/**
 * Parsing-layer types — re-exports from models/types.ts + parsing-specific shapes.
 */
export type {
  ParsedInvoiceData,
  PartsLineItem,
  LabourServiceLineItem,
  ServiceDetails,
  VehicleDetails,
  TotalsAndTaxSummary,
  GstBreakdownLine,
} from '../models/types.js';

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
  parsed: import('../models/types.js').ParsedInvoiceData;
  raw: Record<string, unknown>;
  format: 'schema' | 'legacy';
  validation: ValidationIssue[];
}
