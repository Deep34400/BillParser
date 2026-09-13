import type { ReactNode } from 'react';
import type { Invoice } from '../../types/index.js';
import { costFmt } from '../../lib/format.js';
import { Card, CardContent, CardHeader } from '@/components/ui/card.js';

export function OcrCostPanel({ inv }: { inv: Invoice }) {
  if (inv.costEstimate == null) return null;

  const isSingle = inv.pipelineMode === 'single';
  const model = inv.extractionModel ?? inv.structuringModel ?? '—';
  const latency = ((inv.totalLatencyMs ?? 0) / 1000).toFixed(1);
  const usedFallback = (inv.fallbackAttempts ?? 0) > 1;
  const winner = usedFallback && inv.fallbackHistory
    ? [...inv.fallbackHistory].reverse().find((h) => h.reconciliation_matched)
      ?? inv.fallbackHistory[inv.fallbackHistory.length - 1]
    : null;

  const hasBreakdown = inv.totalInputTokens != null && inv.totalOutputTokens != null;
  const inputTokens = inv.totalInputTokens ?? 0;
  const outputTokens = inv.totalOutputTokens ?? 0;
  const thinkingTokens =
    inv.totalThinkingTokens != null
      ? inv.totalThinkingTokens
      : hasBreakdown
        ? Math.max(0, (inv.totalTokens ?? 0) - inputTokens - outputTokens)
        : 0;
  const billedOutputTokens = outputTokens + thinkingTokens;
  const reportedTotalTokens = inv.totalTokens ?? 0;
  const componentSum = inputTokens + billedOutputTokens;
  const displayTotalTokens = hasBreakdown ? (reportedTotalTokens || componentSum) : reportedTotalTokens;
  const unaccountedTokens = hasBreakdown && reportedTotalTokens > 0
    ? reportedTotalTokens - componentSum
    : 0;
  const extractionPages = inv.extractionPages ?? null;
  const inputRate = inv.inputRatePer1m ?? null;
  const outputRate = inv.outputRatePer1m ?? null;
  const fmtRate = (r: number | string | null | undefined) => {
    const n = Number(r);
    if (!Number.isFinite(n)) return '0';
    const two = n.toFixed(2);
    return Number(two) === n ? two : String(n);
  };
  const rateLabel = (r: number | string | null | undefined) => (r == null ? '' : ` × $${fmtRate(r)}/1M`);
  const usdFmt = (v: number | string | null | undefined) => `$${Number(v || 0).toFixed(4)}`;
  const inputCost = inv.totalInputCostUsd ?? 0;
  const outputCost = inv.totalOutputCostUsd ?? 0;
  const totalCost = inv.costEstimate ?? 0;

  return (
    <Card className="mb-5">
      <CardHeader className="flex-row items-center justify-between border-b border-border bg-muted px-4 py-2.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">OCR cost breakdown</span>
        <span className="text-[10px] font-semibold normal-case tracking-normal text-foreground">
          {isSingle ? 'Single' : 'Split'} · {model} · {latency}s
          {usedFallback && winner && (
            <span className="ml-1.5 text-warning">via {winner.label}</span>
          )}
        </span>
      </CardHeader>
      <CardContent className="space-y-1.5 px-4 py-3 text-xs">
        {hasBreakdown ? (
          <>
            <CostRow
              label={<>Input <span className="text-muted-foreground">(prompt{rateLabel(inputRate) || ` · input $/1M of ${model}`})</span></>}
              tokens={inputTokens}
              cost={inputCost}
              usdFmt={usdFmt}
            />
            <CostRow
              label={<>Output <span className="text-muted-foreground">(answer{thinkingTokens > 0 ? ' + thinking' : ''}{rateLabel(outputRate) || ' · output $/1M'})</span></>}
              tokens={billedOutputTokens}
              cost={outputCost}
              usdFmt={usdFmt}
            />
            {thinkingTokens > 0 && (
              <p className="pl-3 text-[11px] text-muted-foreground">
                ↳ answer {outputTokens.toLocaleString()} + thinking {thinkingTokens.toLocaleString()}
              </p>
            )}
            {extractionPages != null && (
              <p className="pl-3 text-[11px] text-muted-foreground">
                ↳ extraction billed per page — {extractionPages.toLocaleString()} page
                {extractionPages === 1 ? '' : 's'}, not tokens
              </p>
            )}
            {unaccountedTokens !== 0 && (
              <p className="pl-3 text-[11px] text-muted-foreground">
                ↳ {unaccountedTokens > 0 ? '+' : ''}{unaccountedTokens.toLocaleString()} tokens reported
                by the provider beyond input + output — not separately priced
              </p>
            )}
            <div className="flex items-center justify-between border-t border-border pt-2 mt-2">
              <span className="text-sm font-bold">Total cost</span>
              <span>
                <span className="font-mono text-sm font-bold">{costFmt(totalCost)}</span>
                <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{usdFmt(totalCost)}</span>
                <span className="ml-2 text-[11px] text-muted-foreground">
                  {displayTotalTokens.toLocaleString()} tokens
                  {' '}(= {inputTokens.toLocaleString()} + {billedOutputTokens.toLocaleString()})
                </span>
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">Total cost</span>
            <span>
              <span className="font-mono text-sm font-bold">{costFmt(totalCost)}</span>
              <span className="ml-2 text-[11px] text-muted-foreground">
                {displayTotalTokens.toLocaleString()} tokens
              </span>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CostRow({
  label, tokens, cost, usdFmt,
}: {
  label: ReactNode;
  tokens: number;
  cost: number;
  usdFmt: (v: number) => string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <span>
        <span className="font-mono">{tokens.toLocaleString()}</span>
        <span className="text-muted-foreground"> tokens</span>
        <span className="mx-2 text-border">→</span>
        <span className="font-mono font-semibold">{costFmt(cost)}</span>
        <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{usdFmt(cost)}</span>
      </span>
    </div>
  );
}
