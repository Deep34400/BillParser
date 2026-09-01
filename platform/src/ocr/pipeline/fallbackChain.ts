/**
 * Fallback chain orchestrator — tries each configured level in order.
 * Moves to the next level on API error OR reconciliation failure.
 * Returns the first reconciliation-matched result, or the best attempt if all fail.
 */
import type { FallbackLevel } from '../../shared/settings.js';
import type { PipelineResult } from '../process.js';
import { runSingleMode } from './single.js';
import { runSplitMode } from './split.js';
import { enrichParsedInvoice } from '../transformer/normalize/index.js';
import { reconcileInvoiceTotal, type TotalReconciliation } from '../transformer/reconcileTotal.js';

export interface FallbackAttempt {
  level: number;
  label: string;
  mode: 'single' | 'split';
  provider: string;
  model: string;
  reconciliation_matched: boolean;
  difference?: number | null;
  error?: string | null;
  cost_usd: number;
  latency_ms: number;
}

export interface FallbackChainResult extends PipelineResult {
  fallbackAttempts: number;
  fallbackHistory: FallbackAttempt[];
  totalReconciliation: TotalReconciliation;
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
      const latency = result.costInfo.extraction?.latency_ms ?? 0;

      history.push({
        level: i + 1,
        label: level.label,
        mode: level.mode,
        provider: level.provider,
        model: level.model,
        reconciliation_matched: recon.matched,
        difference: recon.difference,
        cost_usd: result.costInfo.total_cost_usd,
        latency_ms: latency,
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
