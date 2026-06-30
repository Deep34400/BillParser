import { useState, useEffect } from 'react';
import type { Invoice, ExtractionRun } from '../types/index.js';
import { api } from '../api/client.js';
import { T, STATUS } from '../theme.js';
import { money, confLabel, confColor } from '../lib/format.js';

// ---------------------------------------------------------------------------
// Provider reference data (representative / static — no API call needed)
// ---------------------------------------------------------------------------
const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  mistral: 'Mistral',
  azure: 'Azure',
  llamaparse: 'LlamaParse',
  textract: 'Textract',
  google: 'Google',
};

const PROVIDER_REF: Record<string, { costPer1k: number; headerAcc: number; lineAcc: number; pattern: string }> = {
  gemini: { costPer1k: 2, headerAcc: 0.88, lineAcc: 0.84, pattern: 'OCR→md + LLM' },
  mistral: { costPer1k: 2, headerAcc: 0.9, lineAcc: 0.85, pattern: 'OCR→md + LLM' },
  azure: { costPer1k: 10, headerAcc: 0.93, lineAcc: 0.87, pattern: 'prebuilt invoice' },
  llamaparse: { costPer1k: 9, headerAcc: 0.9, lineAcc: 0.85, pattern: 'OCR→md + LLM' },
  textract: { costPer1k: 10, headerAcc: 0.78, lineAcc: 0.82, pattern: 'structured fields' },
  google: { costPer1k: 20, headerAcc: 0.4, lineAcc: 0.4, pattern: 'structured fields' },
};

const labelFor = (p: string) => PROVIDER_LABELS[p] ?? (p.charAt(0).toUpperCase() + p.slice(1));

// ---------------------------------------------------------------------------
// AccuracyBar — a simple labeled track
// ---------------------------------------------------------------------------
function AccuracyBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(value * 100);
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: T.muted, marginBottom: 3 }}>
        <span>{label}</span>
        <span aria-label={`${pct} percent`} style={{ fontVariantNumeric: 'tabular-nums' }}>{pct}<span style={{ fontSize: 9 }}>/100</span></span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: T.border, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetricRow — a simple label/value pair
// ---------------------------------------------------------------------------
function MetricRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: `1px solid ${T.border}`, fontSize: 12 }}>
      <span style={{ color: T.muted }}>{label}</span>
      <span style={{ fontWeight: 600, color: valueColor ?? T.text, fontFamily: T.mono }}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunCard — one provider card
// ---------------------------------------------------------------------------
function RunCard({ run, invoice, onApplied }: { run: ExtractionRun; invoice: Invoice; onApplied: () => void }) {
  const [applying, setApplying] = useState(false);
  const ref = PROVIDER_REF[run.provider];
  const isFailed = run.status === 'FAILED';
  const statusInfo = STATUS[run.status] ?? { label: run.status, color: T.muted };
  const conf = run.confidence ?? 0;

  // Compute delta vs source invoice total
  const totalRead = (run.fieldsSnapshot?.totalAmount as number | undefined) ?? null;
  const delta = totalRead != null && invoice.totalAmount != null ? totalRead - invoice.totalAmount : null;
  const deltaColor = delta == null ? T.muted : delta >= 0 ? T.green : T.red;
  const deltaStr = delta == null ? '—' : `${delta >= 0 ? '+' : ''}${money(delta, invoice.currency ?? 'USD')}`;

  // Latency display
  const latencyStr = run.latencyMs == null ? '—' : run.latencyMs >= 1000 ? `${(run.latencyMs / 1000).toFixed(1)} s` : `${run.latencyMs} ms`;

  async function handleApply() {
    setApplying(true);
    try {
      await api.applyRun(invoice.id, run.id);
      onApplied();
    } catch (_e) {
      setApplying(false);
    }
  }

  return (
    <div style={{
      width: 202,
      flexShrink: 0,
      background: T.panel,
      border: `1px solid ${T.border}`,
      borderRadius: 10,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 12px 8px',
        borderBottom: `1px solid ${T.border}`,
        background: T.rail,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
      }}>
        <span style={{ fontWeight: 700, fontSize: 13, color: T.text }}>{labelFor(run.provider)}</span>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          color: statusInfo.color,
          background: statusInfo.color + '18',
          border: `1px solid ${statusInfo.color}40`,
          borderRadius: 20,
          padding: '1px 7px',
          letterSpacing: '0.03em',
        }}>
          {statusInfo.label}
        </span>
      </div>

      {/* Body */}
      <div style={{ padding: '12px', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isFailed ? (
          /* Error state */
          <div style={{ fontSize: 12, color: T.red, fontFamily: T.mono, wordBreak: 'break-word' }}>
            {run.error ?? 'Extraction failed.'}
          </div>
        ) : (
          <>
            {/* Big confidence number */}
            <div style={{ textAlign: 'center', padding: '6px 0 8px' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: confColor(conf), fontFamily: T.mono, lineHeight: 1 }}>
                {confLabel(run.confidence)}
              </div>
              <div style={{ fontSize: 10, color: T.muted, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                overall confidence
              </div>
            </div>

            {/* Accuracy bars (from PROVIDER_REF — representative) */}
            {ref && (
              <div>
                <AccuracyBar label="Header accuracy" value={ref.headerAcc} color={T.accent} />
                <AccuracyBar label="Line accuracy" value={ref.lineAcc} color={T.green} />
              </div>
            )}

            {/* Metrics list */}
            <div>
              <MetricRow label="Line items" value={String(run.itemsSnapshot?.length ?? 0)} />
              <MetricRow label="Total read" value={money(totalRead, invoice.currency ?? 'USD')} />
              <MetricRow label="Δ source" value={deltaStr} valueColor={deltaColor} />
              {ref && <MetricRow label="Cost / 1k" value={`$${ref.costPer1k}`} />}
              <MetricRow label="Latency" value={latencyStr} />
              {ref && <MetricRow label="Pattern" value={ref.pattern} />}
            </div>
          </>
        )}
      </div>

      {/* Footer: apply button */}
      <div style={{ padding: '10px 12px', borderTop: `1px solid ${T.border}` }}>
        <button
          disabled={isFailed || applying}
          onClick={() => void handleApply()}
          style={{
            width: '100%',
            padding: '7px 0',
            border: 'none',
            borderRadius: 7,
            background: isFailed || applying ? T.border : T.accent,
            color: isFailed || applying ? T.muted : '#fff',
            fontSize: 12,
            fontWeight: 600,
            cursor: isFailed || applying ? 'not-allowed' : 'pointer',
            fontFamily: T.font,
          }}
        >
          {applying ? 'Applying…' : 'Use this engine'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BakeoffOverlay
// ---------------------------------------------------------------------------
export function BakeoffOverlay({ invoice, onClose, onApplied }: { invoice: Invoice; onClose: () => void; onApplied: () => void }) {
  const [loading, setLoading] = useState(true);
  const [runs, setRuns] = useState<ExtractionRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.bakeoff(invoice.id)
      .then((res) => { setRuns(res.runs); })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Bake-off failed.'); })
      .finally(() => { setLoading(false); });
  }, [invoice.id]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(16,18,21,.5)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: T.bg,
          borderRadius: 12,
          width: '100%',
          maxWidth: 1140,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 64px rgba(0,0,0,.22)',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 24px',
          borderBottom: `1px solid ${T.border}`,
          background: T.panel,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: T.text }}>Provider bake-off</div>
            <div style={{ fontSize: 13, color: T.muted, marginTop: 3 }}>
              {invoice.vendorName} · same file, every engine
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: `1px solid ${T.border}`,
              borderRadius: 7,
              width: 30,
              height: 30,
              cursor: 'pointer',
              fontSize: 16,
              color: T.muted,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              fontFamily: T.font,
            }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Disclaimer note */}
        <div style={{
          padding: '8px 24px',
          fontSize: 12,
          color: T.faint,
          background: T.rail,
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}>
          Each engine normalizes into the same canonical schema. Figures are representative; run live to confirm.
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ color: T.muted, fontSize: 14, textAlign: 'center', padding: '40px 0' }}>
              Running every configured engine…
            </div>
          ) : error ? (
            <div style={{ color: T.red, fontSize: 14, padding: '20px 0' }}>{error}</div>
          ) : runs.length === 0 ? (
            <div style={{ color: T.muted, fontSize: 14, padding: '20px 0' }}>
              No providers are configured. Add credentials in Settings.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 14, overflowX: 'auto', paddingBottom: 8 }}>
              {runs.map((run) => (
                <RunCard key={run.id} run={run} invoice={invoice} onApplied={onApplied} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
