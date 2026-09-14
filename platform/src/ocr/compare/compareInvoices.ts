import type { ParsedInvoiceData } from '../../shared/types.js';
import { getBill } from '../repository.js';
import { ValidationError, NotFoundError } from '../../shared/errors.js';
import { coerceCompareInvoice, invoiceHasContent } from './normalizeJson.js';
import { leftoverNames, diffParsedInvoices } from './diffInvoices.js';
import { aiMatchLeftovers, aiNarrative, resolveCompareModel, type CompareModelInfo } from './aiMatch.js';
import { validateAiPairs, validateSummaryClaims } from './validateAiPairs.js';
import { buildMismatches } from './mismatches.js';
import type { CompareResult } from './types.js';

const DONE = new Set(['OCR_COMPLETED', 'NEED_REVIEW', 'VERIFIED']);

function parsedFromBill(bill: { parsed_data?: ParsedInvoiceData | null; ocr_status: string; bill_id: string }): ParsedInvoiceData {
  if (bill.ocr_status === 'PROCESSING' || bill.ocr_status === 'UPLOADED') {
    throw new ValidationError(`Invoice ${bill.bill_id} is still processing`);
  }
  if (bill.ocr_status === 'FAILED' || !invoiceHasContent(bill.parsed_data ?? {})) {
    throw new ValidationError(`Cannot compare invoice ${bill.bill_id} — no extracted data`);
  }
  return coerceCompareInvoice(bill.parsed_data);
}

async function runCompare(
  left: ParsedInvoiceData,
  right: ParsedInvoiceData,
  source: CompareResult['source'],
  idA: string | null,
  idB: string | null,
  useAi: boolean,
  modelOverride?: { provider?: string; model?: string },
): Promise<CompareResult> {
  let model: CompareModelInfo = await resolveCompareModel(modelOverride);
  let acceptedPairs: Array<{ group: 'parts' | 'labour'; a: number; b: number; confidence: number }> = [];
  const rejectedAi: CompareResult['validation']['rejectedAi'] = [];

  if (useAi) {
    const leftovers = leftoverNames(left, right);
    const needAi = leftovers.parts.leftoverA.length > 0 && leftovers.parts.leftoverB.length > 0
      || leftovers.labour.leftoverA.length > 0 && leftovers.labour.leftoverB.length > 0;

    if (needAi) {
      const [partHit, labourHit] = await Promise.all([
        aiMatchLeftovers('parts', leftovers.parts.leftoverA.map((l) => l.name), leftovers.parts.leftoverB.map((l) => l.name), model),
        aiMatchLeftovers('labour', leftovers.labour.leftoverA.map((l) => l.name), leftovers.labour.leftoverB.map((l) => l.name), model),
      ]);
      model = partHit.info.used ? partHit.info : labourHit.info;

      const partsVal = validateAiPairs(leftovers.parts.leftoverA, leftovers.parts.leftoverB, partHit.pairs);
      const labourVal = validateAiPairs(leftovers.labour.leftoverA, leftovers.labour.leftoverB, labourHit.pairs);
      acceptedPairs = [...partsVal.accepted, ...labourVal.accepted];
      rejectedAi.push(...partsVal.rejected, ...labourVal.rejected);
    }
  }

  const result = diffParsedInvoices(left, right, { source, idA, idB, aiPairs: acceptedPairs });
  result.model = model;
  result.validation = {
    acceptedAi: acceptedPairs.length,
    rejectedAi,
    summaryOk: true,
    summaryIssues: [],
  };

  if (useAi && (result.counts.missing || result.counts.extra || result.counts.aiPairs || rejectedAi.length)) {
    const { claim, info } = await aiNarrative(
      result.summary.rules,
      `Accepted AI pairs: ${acceptedPairs.length}. Rejected: ${rejectedAi.map((r) => r.reason).join('; ') || 'none'}`,
      model,
    );
    result.model = info;
    if (claim) {
      result.summary.ai = claim.text;
      const missing = [...result.parts, ...result.labour].filter((l) => l.status === 'missing_in_b').map((l) => l.a ?? '');
      const extra = [...result.parts, ...result.labour].filter((l) => l.status === 'extra_in_b').map((l) => l.b ?? '');
      const changed = [...result.parts, ...result.labour].filter((l) => l.status === 'same_item').map((l) => l.a ?? l.description);
      const checked = validateSummaryClaims(claim, missing, extra, changed);
      result.validation.summaryOk = checked.ok;
      result.validation.summaryIssues = checked.issues;
    }
  }

  result.mismatches = buildMismatches(result);
  return result;
}

export async function compareByIds(
  id1: string,
  id2: string,
  userId: string | undefined,
  useAi: boolean,
  modelOverride?: { provider?: string; model?: string },
): Promise<CompareResult> {
  const a = await getBill(id1, userId);
  const b = await getBill(id2, userId);
  if (!a) throw new NotFoundError('Invoice', id1);
  if (!b) throw new NotFoundError('Invoice', id2);
  if (!DONE.has(a.ocr_status) && a.ocr_status !== 'FAILED') {
    throw new ValidationError(`Invoice ${id1} is not ready (${a.ocr_status})`);
  }
  if (!DONE.has(b.ocr_status) && b.ocr_status !== 'FAILED') {
    throw new ValidationError(`Invoice ${id2} is not ready (${b.ocr_status})`);
  }
  return runCompare(parsedFromBill(a), parsedFromBill(b), 'ids', a.bill_id, b.bill_id, useAi, modelOverride);
}

export async function compareByJson(
  left: unknown,
  right: unknown,
  useAi: boolean,
  modelOverride?: { provider?: string; model?: string },
): Promise<CompareResult> {
  const a = coerceCompareInvoice(left);
  const b = coerceCompareInvoice(right);
  if (!invoiceHasContent(a) || !invoiceHasContent(b)) {
    throw new ValidationError('Both JSON sides need invoice fields (totals or line items)');
  }
  return runCompare(a, b, 'json', null, null, useAi, modelOverride);
}
