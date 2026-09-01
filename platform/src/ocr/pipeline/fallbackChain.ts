/**
 * Fallback chain orchestrator — tries each configured level in order.
 * Moves to the next level on API error OR reconciliation failure.
 * Returns the first reconciliation-matched result, or the best attempt if all fail.
 *
 * Each attempt stores:
 *   - parsed_snapshot (full OCR) for UI compare
 *   - recon_breakdown (parts base vs parts total, etc.) so UI can show WHY reconcile failed
 * Main flow unchanged: bill.parsed_data = winning result only.
 */
import type { FallbackLevel } from '../../shared/settings.js';
import type { ParsedInvoiceData } from '../types/invoice.js';
import type { PipelineResult } from '../process.js';
import { runSingleMode } from './single.js';
import { runSplitMode } from './split.js';
import { enrichParsedInvoice } from '../transformer/normalize/index.js';
import { reconcileInvoiceTotal, type TotalReconciliation } from '../transformer/reconcileTotal.js';
import { computeReview } from '../transformer/review.js';

export interface ReconBreakdown {
  matched: boolean;
  difference: number | null;
  reason: string | null;
  /** Σ(qty×rate) from parts lines (taxable_amount=0 → 0) */
  parts_base: number;
  /** parts_total from invoice footer/header */
  parts_total: number | null;
  parts_base_diff: number | null;
  parts_base_ok: boolean;
  /** Σ labour_charges */
  labour_base: number;
  labour_total: number | null;
  labour_base_diff: number | null;
  labour_base_ok: boolean;
  calculated_total: number;
  grand_total_invoice: number | null;
  parts_count: number;
  labour_count: number;
  review_codes: string[];
}

export interface FallbackAttempt {
  level: number;
  label: string;
  mode: 'single' | 'split';
  provider: string;
  model: string;
  reconciliation_matched: boolean;
  difference?: number | null;
  calculated_total?: number | null;
  grand_total_invoice?: number | null;
  error?: string | null;
  cost_usd: number;
  latency_ms: number;
  parsed_snapshot?: ParsedInvoiceData | null;
  summary?: {
    company_name?: string | null;
    invoice_number?: string | null;
    gstin?: string | null;
    parts_count: number;
    labour_count: number;
    grand_total?: number | null;
    parts_total?: number | null;
    labour_total?: number | null;
  } | null;
  /** Clear reconcile math for UI — why this attempt failed/passed */
  recon_breakdown?: ReconBreakdown | null;
}

export interface FallbackChainResult extends PipelineResult {
  fallbackAttempts: number;
  fallbackHistory: FallbackAttempt[];
  totalReconciliation: TotalReconciliation;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildSummary(parsed: ParsedInvoiceData) {
  const t = parsed.totals_and_tax_summary;
  return {
    company_name: parsed.company_name ?? null,
    invoice_number: parsed.invoice_number ?? null,
    gstin: parsed.gstin ?? null,
    parts_count: parsed.parts_line_items?.length ?? 0,
    labour_count: parsed.labour_service_line_items?.length ?? 0,
    grand_total: t?.grand_total_invoice ?? null,
    parts_total: t?.parts_total ?? null,
    labour_total: t?.labour_total ?? null,
  };
}

function buildReconBreakdown(parsed: ParsedInvoiceData, recon: TotalReconciliation): ReconBreakdown {
  const t = parsed.totals_and_tax_summary;
  const partsBase = recon.parts_base;
  const labourBase = recon.labour_base;
  const partsTotal = t?.parts_total ?? null;
  const labourTotal = t?.labour_total ?? null;
  const partsDiff = partsTotal != null ? roundMoney(Math.abs(partsBase - partsTotal)) : null;
  const labourDiff = labourTotal != null ? roundMoney(Math.abs(labourBase - labourTotal)) : null;
  const review = computeReview(parsed);
  const reconCodes = review.codes.filter((c) =>
    c === 'TOTAL_MISMATCH' || c === 'PARTS_BASE_MISMATCH' || c === 'LABOUR_BASE_MISMATCH',
  );

  return {
    matched: recon.matched,
    difference: recon.difference,
    reason: recon.reason,
    parts_base: partsBase,
    parts_total: partsTotal,
    parts_base_diff: partsDiff,
    parts_base_ok: partsDiff == null || partsDiff <= 2,
    labour_base: labourBase,
    labour_total: labourTotal,
    labour_base_diff: labourDiff,
    labour_base_ok: labourDiff == null || labourDiff <= 2,
    calculated_total: recon.calculated_total,
    grand_total_invoice: recon.grand_total_invoice,
    parts_count: parsed.parts_line_items?.length ?? 0,
    labour_count: parsed.labour_service_line_items?.length ?? 0,
    review_codes: reconCodes,
  };
}

export async function runFallbackChain(
  buf: Buffer,
  chain: FallbackLevel[],
  contextId: string,
): Promise<FallbackChainResult> {
  const enabled = chain.filter((l) => l.enabled);
  if (enabled.length === 0) {
    throw new Error('No OCR models configured in settings. Add at least one fallback level.');
  }

  let bestResult: PipelineResult | null = null;
  let bestRecon: TotalReconciliation | null = null;
  let bestDiff = Infinity;
  const history: FallbackAttempt[] = [];

  for (const [i, level] of enabled.entries()) {
    const tag = `${level.label} (${level.mode}/${level.provider}/${level.model})`;
    console.log(`[OCR] ${contextId} — fallback chain attempt ${i + 1}/${enabled.length}: ${tag}`);

    try {
      const result = level.mode === 'single'
        ? await runSingleMode(buf, level.provider, level.model, contextId)
        : await runSplitMode(
            buf,
            level.structuringProvider ?? level.provider,
            level.structuringModel ?? level.model,
            contextId,
          );

      const enriched = enrichParsedInvoice(result.parsed, result.rawOcr);
      const recon = reconcileInvoiceTotal(enriched);
      const breakdown = buildReconBreakdown(enriched, recon);
      const latency = result.costInfo.extraction?.latency_ms ?? 0;

      history.push({
        level: i + 1,
        label: level.label,
        mode: level.mode,
        provider: level.provider,
        model: level.model,
        reconciliation_matched: recon.matched,
        difference: recon.difference,
        calculated_total: recon.calculated_total,
        grand_total_invoice: recon.grand_total_invoice,
        cost_usd: result.costInfo.total_cost_usd,
        latency_ms: latency,
        parsed_snapshot: enriched,
        summary: buildSummary(enriched),
        recon_breakdown: breakdown,
      });

      if (recon.matched) {
        console.log(`[OCR] ${contextId} — ${tag} reconciliation MATCHED, stopping chain.`);
        return {
          ...result,
          parsed: enriched,
          fallbackAttempts: i + 1,
          fallbackHistory: history,
          totalReconciliation: recon,
        };
      }

      console.warn(
        `[OCR] ${contextId} — ${tag} reconciliation FAILED (diff=${recon.difference}), ` +
        `parts_base=${breakdown.parts_base} vs parts_total=${breakdown.parts_total}, ` +
        `${i + 1 < enabled.length ? 'trying next level...' : 'no more levels.'}`,
      );

      const diff = Math.abs(recon.difference ?? Infinity);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestResult = { ...result, parsed: enriched };
        bestRecon = recon;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[OCR] ${contextId} — ${tag} FAILED: ${msg}`);

      history.push({
        level: i + 1,
        label: level.label,
        mode: level.mode,
        provider: level.provider,
        model: level.model,
        reconciliation_matched: false,
        error: msg,
        cost_usd: 0,
        latency_ms: 0,
        parsed_snapshot: null,
        summary: null,
        recon_breakdown: null,
      });
    }
  }

  if (!bestResult || !bestRecon) {
    throw new Error(
      `All ${enabled.length} OCR model(s) failed. ` +
      history.map((h) => `${h.label}: ${h.error ?? 'unknown'}`).join('; '),
    );
  }

  console.warn(
    `[OCR] ${contextId} — all ${enabled.length} levels failed reconciliation. ` +
    `Returning best attempt (diff=${bestRecon.difference}).`,
  );

  return {
    ...bestResult,
    fallbackAttempts: history.length,
    fallbackHistory: history,
    totalReconciliation: bestRecon,
  };
}
