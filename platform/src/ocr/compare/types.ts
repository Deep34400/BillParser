export type FieldStatus = 'match' | 'diff' | 'missing_in_a' | 'missing_in_b';
export type LineStatus = 'match' | 'same_item' | 'missing_in_b' | 'extra_in_b';
export type MatchHow = 'exact' | 'fuzzy' | 'ai' | 'none';

export interface FieldDiff {
  field: string;
  a: string | number | null;
  b: string | number | null;
  status: FieldStatus;
  delta?: number;
  deltaPct?: number;
}

export interface LineDiff {
  status: LineStatus;
  how: MatchHow;
  description: string;
  a?: string | null;
  b?: string | null;
  aAmount?: number | null;
  bAmount?: number | null;
  changes?: FieldDiff[];
  confidence?: number;
}

export interface CompareCounts {
  matched: number;
  changed: number;
  missing: number;
  extra: number;
  aiPairs: number;
}

export interface CompareSummary {
  rules: string;
  ai: string | null;
}

export interface CompareModelUsed {
  provider: string;
  model: string;
  used: boolean;
  error?: string;
}

export interface CompareValidation {
  acceptedAi: number;
  rejectedAi: Array<{ a: string; b: string; reason: string; confidence: number }>;
  summaryOk: boolean;
  summaryIssues: string[];
}

export interface CompareMismatch {
  kind: 'header' | 'total' | 'missing' | 'extra' | 'changed' | 'rejected_ai';
  label: string;
  detail: string;
  check: 'review';
}

export interface InvoiceCard {
  id: string | null;
  vendorName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  total: number | null;
}

export interface CompareResult {
  source: 'ids' | 'json' | 'files';
  invoiceA: InvoiceCard;
  invoiceB: InvoiceCard;
  header: FieldDiff[];
  totals: FieldDiff[];
  parts: LineDiff[];
  labour: LineDiff[];
  counts: CompareCounts;
  summary: CompareSummary;
  model: CompareModelUsed;
  validation: CompareValidation;
  mismatches: CompareMismatch[];
}
