import { useState, useCallback, useEffect } from 'react';
import { api } from '../api/client.js';
import { T } from '../theme.js';

interface OdometerResultItem {
  id: string;
  url: string;
  odometer_km: number | null;
  confidence?: number;
  provider?: string;
  model?: string;
  raw_text?: string;
  notes?: string;
  latency_ms?: number;
  loading?: boolean;
  error?: string;
  needsReview?: boolean;
  reviewReason?: string;
  pipelineMode?: string;
}

export function OdometerPage() {
  const [urlInput, setUrlInput] = useState('');
  const [crossVerify, setCrossVerify] = useState(false);
  const [results, setResults] = useState<OdometerResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pipelineInfo, setPipelineInfo] = useState<{ mode: string; provider: string; model: string } | null>(null);

  useEffect(() => {
    api.settings().then((s) => {
      if (s.pipelineMode === 'split') {
        setPipelineInfo({ mode: 'Split', provider: `Mistral OCR → ${s.structuringProvider ?? 'gemini'}`, model: s.structuringModel ?? '' });
      } else {
        setPipelineInfo({ mode: 'Single', provider: s.singleProvider ?? 'gemini', model: s.singleModel ?? '' });
      }
    }).catch(() => {});
  }, []);

  const extractSingle = useCallback(async (imageUrl: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item: OdometerResultItem = { id, url: imageUrl, odometer_km: null, loading: true };
    setResults((prev) => [item, ...prev]);

    try {
      const res = await api.odometerExtract(imageUrl, crossVerify);
      setResults((prev) =>
        prev.map((r) =>
          r.id === id
            ? {
                ...r,
                loading: false,
                odometer_km: res.data.odometer_km,
                confidence: res.data.primary?.confidence,
                provider: res.data.primary?.provider,
                model: res.data.primary?.model,
                raw_text: res.data.primary?.raw_text,
                notes: res.data.primary?.notes,
                latency_ms: res.data.primary?.latency_ms,
                needsReview: res.data.needsReview,
                reviewReason: res.data.reviewReason,
                pipelineMode: res.data.pipelineMode,
              }
            : r,
        ),
      );
    } catch (err) {
      setResults((prev) =>
        prev.map((r) => (r.id === id ? { ...r, loading: false, error: (err as Error).message } : r)),
      );
    }
  }, [crossVerify]);

  const handleExtract = useCallback(async () => {
    const urls = urlInput
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.startsWith('http'));

    if (urls.length === 0) return;
    setLoading(true);

    for (const url of urls) {
      await extractSingle(url);
    }
    setLoading(false);
    setUrlInput('');
  }, [urlInput, extractSingle]);

  const clearResults = () => setResults([]);

  const confidenceColor = (c?: number) => {
    if (c == null) return T.inkFaint;
    if (c >= 0.85) return T.success;
    if (c >= 0.6) return T.warn;
    return T.danger;
  };

  return (
    <div style={{ padding: 32, maxWidth: 1100, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontFamily: T.heading, fontSize: 26, color: T.ink, margin: 0 }}>
          Odometer OCR
        </h1>
        <p style={{ color: T.inkSoft, margin: '6px 0 0', fontSize: 14 }}>
          Extract odometer readings from vehicle dashboard images using the configured pipeline.
        </p>
      </div>

      {/* Pipeline Info Banner */}
      {pipelineInfo && (
        <div style={{
          background: T.accentSoft,
          border: `1px solid ${T.accent}`,
          borderRadius: 8,
          padding: '10px 16px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          fontSize: 13,
        }}>
          <span style={{ fontWeight: 600, color: T.accent }}>
            {pipelineInfo.mode === 'Split' ? 'SPLIT' : 'SINGLE'}
          </span>
          <span style={{ color: T.ink }}>
            {pipelineInfo.provider}
            {pipelineInfo.model && <span style={{ color: T.inkSoft }}> ({pipelineInfo.model})</span>}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: T.inkSoft }}>
            Configured in Settings page
          </span>
        </div>
      )}

      {/* Input Panel */}
      <div
        style={{
          background: T.surface,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          padding: 24,
          marginBottom: 24,
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 13, fontWeight: 600, color: T.ink, display: 'block', marginBottom: 6 }}>
            Image URL(s) — one per line
          </label>
          <textarea
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder={'https://s3-bucket.example.com/odometer-readings/image1.webp\nhttps://s3-bucket.example.com/odometer-readings/image2.png'}
            style={{
              width: '100%',
              minHeight: 100,
              padding: 12,
              borderRadius: 6,
              border: `1px solid ${T.border}`,
              fontFamily: T.mono,
              fontSize: 12,
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Controls Row */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, color: T.ink, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={crossVerify}
              onChange={(e) => setCrossVerify(e.target.checked)}
            />
            Cross-verify (run both Gemini + Mistral)
          </label>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {results.length > 0 && (
              <button
                onClick={clearResults}
                style={{
                  padding: '8px 16px',
                  borderRadius: 6,
                  border: `1px solid ${T.border}`,
                  background: T.surface,
                  color: T.inkSoft,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            )}
            <button
              onClick={handleExtract}
              disabled={loading || !urlInput.trim()}
              style={{
                padding: '8px 20px',
                borderRadius: 6,
                border: 'none',
                background: loading ? T.inkFaint : T.accent,
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
              }}
            >
              {loading ? 'Extracting...' : 'Extract Reading'}
            </button>
          </div>
        </div>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: T.ink }}>
              Results ({results.filter((r) => !r.loading).length}/{results.length})
            </span>
            <span style={{ fontSize: 12, color: T.inkSoft }}>
              Avg confidence: {
                (() => {
                  const done = results.filter((r) => r.confidence != null);
                  if (!done.length) return '—';
                  return (done.reduce((s, r) => s + (r.confidence ?? 0), 0) / done.length * 100).toFixed(0) + '%';
                })()
              }
            </span>
          </div>

          <div style={{ maxHeight: 600, overflowY: 'auto' }}>
            {results.map((item) => (
              <div key={item.id}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '120px 1fr 120px 100px 100px',
                    padding: '14px 20px',
                    borderBottom: item.needsReview && item.reviewReason && !item.loading ? 'none' : `1px solid ${T.border}`,
                    alignItems: 'center',
                    gap: 12,
                    opacity: item.loading ? 0.6 : 1,
                  }}
                >
                  {/* Thumbnail */}
                  <div style={{ width: 100, height: 66, borderRadius: 6, overflow: 'hidden', background: '#f0f0f0' }}>
                    <img
                      src={item.url}
                      alt="odometer"
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>

                  {/* URL + details */}
                  <div style={{ overflow: 'hidden' }}>
                    <div style={{ fontSize: 11, color: T.inkFaint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4 }}>
                      {item.url}
                    </div>
                    {item.error ? (
                      <div style={{ fontSize: 12, color: T.danger }}>{item.error}</div>
                    ) : item.loading ? (
                      <div style={{ fontSize: 12, color: T.accent }}>Processing...</div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, fontSize: 11, color: T.inkSoft }}>
                        <span style={{ background: T.accentSoft, padding: '1px 5px', borderRadius: 3 }}>
                          {item.pipelineMode === 'split' ? 'Split' : 'Single'}
                        </span>
                        <span>{item.provider}</span>
                        {item.latency_ms && <span>{(item.latency_ms / 1000).toFixed(1)}s</span>}
                        {item.raw_text && <span>Raw: "{item.raw_text}"</span>}
                      </div>
                    )}
                    {item.notes && <div style={{ fontSize: 11, color: T.inkFaint, marginTop: 2 }}>{item.notes}</div>}
                  </div>

                  {/* Reading */}
                  <div style={{ textAlign: 'right' }}>
                    {item.loading ? (
                      <span style={{ fontSize: 13, color: T.inkFaint }}>...</span>
                    ) : item.odometer_km != null ? (
                      <span style={{ fontSize: 18, fontWeight: 700, fontFamily: T.mono, color: T.ink }}>
                        {item.odometer_km.toLocaleString()}
                        <span style={{ fontSize: 11, color: T.inkSoft, marginLeft: 2 }}>km</span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 13, color: T.danger }}>N/A</span>
                    )}
                  </div>

                  {/* Confidence */}
                  <div style={{ textAlign: 'center' }}>
                    {item.confidence != null && (
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: confidenceColor(item.confidence),
                          background: item.confidence >= 0.85 ? T.successSoft : item.confidence >= 0.6 ? T.warnSoft : T.dangerSoft,
                          padding: '3px 8px',
                          borderRadius: 10,
                        }}
                      >
                        {(item.confidence * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>

                  {/* Status indicator */}
                  <div style={{ textAlign: 'center' }}>
                    {item.loading && <span style={{ fontSize: 20 }}>&#9696;</span>}
                    {!item.loading && !item.error && !item.needsReview && <span style={{ color: T.success, fontSize: 16 }}>&#10003;</span>}
                    {!item.loading && !item.error && item.needsReview && (
                      <span title={item.reviewReason} style={{ color: T.warn, fontSize: 14, fontWeight: 600, cursor: 'help' }}>&#9888;</span>
                    )}
                    {!item.loading && item.error && <span style={{ color: T.danger, fontSize: 16 }}>&#10007;</span>}
                  </div>
                </div>
                {/* Review warning banner */}
                {item.needsReview && item.reviewReason && !item.loading && (
                  <div style={{ padding: '6px 20px 10px', borderBottom: `1px solid ${T.border}`, background: T.warnSoft }}>
                    <span style={{ fontSize: 11, color: T.warn, fontWeight: 500 }}>
                      Needs review: {item.reviewReason}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {results.length === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            background: T.surface,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 12, opacity: 0.4 }}>&#128663;</div>
          <p style={{ color: T.inkSoft, fontSize: 14, margin: 0 }}>
            Paste odometer image URLs above and click "Extract Reading" to get started.
          </p>
          <p style={{ color: T.inkFaint, fontSize: 12, margin: '8px 0 0' }}>
            Uses the same pipeline configured in Settings (Single or Split mode).
          </p>
        </div>
      )}
    </div>
  );
}
