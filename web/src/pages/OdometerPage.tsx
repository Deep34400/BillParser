import { useState, useCallback, useEffect } from 'react';
import { Gauge, CheckCircle, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import { api } from '../api/client.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import { Textarea } from '@/components/ui/textarea.js';
import { Card, CardContent } from '@/components/ui/card.js';
import { Badge } from '@/components/ui/badge.js';
import { EmptyState } from '@/components/ui/empty-state.js';

interface OdometerResultItem {
  id: string; url: string; odometer_km: number | null; confidence?: number;
  provider?: string; model?: string; raw_text?: string; notes?: string;
  latency_ms?: number; loading?: boolean; error?: string;
  needsReview?: boolean; reviewReason?: string; pipelineMode?: string;
}

export function OdometerPage() {
  const [urlInput, setUrlInput] = useState('');
  const [crossVerify, setCrossVerify] = useState(false);
  const [results, setResults] = useState<OdometerResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [pipelineInfo, setPipelineInfo] = useState<{ mode: string; provider: string; model: string } | null>(null);

  useEffect(() => {
    api.settings().then((s) => {
      if (s.pipelineMode === 'split') setPipelineInfo({ mode: 'Split', provider: `Mistral OCR → ${s.structuringProvider ?? 'gemini'}`, model: s.structuringModel ?? '' });
      else setPipelineInfo({ mode: 'Single', provider: s.singleProvider ?? 'gemini', model: s.singleModel ?? '' });
    }).catch(() => {});
  }, []);

  const extractSingle = useCallback(async (imageUrl: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const item: OdometerResultItem = { id, url: imageUrl, odometer_km: null, loading: true };
    setResults((prev) => [item, ...prev]);
    try {
      const res = await api.odometerExtract(imageUrl, crossVerify);
      setResults((prev) => prev.map((r) => r.id === id ? { ...r, loading: false, odometer_km: res.data.odometer_km, confidence: res.data.primary?.confidence, provider: res.data.primary?.provider, model: res.data.primary?.model, raw_text: res.data.primary?.raw_text, notes: res.data.primary?.notes, latency_ms: res.data.primary?.latency_ms, needsReview: res.data.needsReview, reviewReason: res.data.reviewReason, pipelineMode: res.data.pipelineMode } : r));
    } catch (err) {
      setResults((prev) => prev.map((r) => (r.id === id ? { ...r, loading: false, error: (err as Error).message } : r)));
    }
  }, [crossVerify]);

  const handleExtract = useCallback(async () => {
    const urls = urlInput.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('http'));
    if (urls.length === 0) return;
    setLoading(true);
    for (const url of urls) await extractSingle(url);
    setLoading(false); setUrlInput('');
  }, [urlInput, extractSingle]);

  return (
    <div className="max-w-[1100px] mx-auto px-7 py-8 font-sans">
      <div className="mb-7">
        <h1 className="font-heading text-2xl font-semibold">Odometer OCR</h1>
        <p className="text-sm text-muted-foreground mt-1">Extract odometer readings from vehicle dashboard images using the configured pipeline.</p>
      </div>

      {pipelineInfo && (
        <Card className="mb-4 border-primary/20 bg-secondary">
          <CardContent className="flex items-center gap-3 py-2.5 text-sm">
            <Badge variant="info">{pipelineInfo.mode}</Badge>
            <span>{pipelineInfo.provider}{pipelineInfo.model && <span className="text-muted-foreground"> ({pipelineInfo.model})</span>}</span>
            <span className="ml-auto text-[11px] text-faint">Configured in Settings</span>
          </CardContent>
        </Card>
      )}

      {/* Input panel */}
      <Card className="mb-6">
        <CardContent className="pt-5 space-y-4">
          <div>
            <label className="mb-1.5 block text-sm font-semibold">Image URL(s) — one per line</label>
            <Textarea value={urlInput} onChange={(e) => setUrlInput(e.target.value)} rows={4}
              placeholder={'https://s3-bucket.example.com/odometer-readings/image1.webp\nhttps://s3-bucket.example.com/odometer-readings/image2.png'}
              className="font-mono text-xs" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={crossVerify} onChange={(e) => setCrossVerify(e.target.checked)} />
              Cross-verify (run both Gemini + Mistral)
            </label>
            <div className="ml-auto flex gap-2">
              {results.length > 0 && <Button variant="outline" onClick={() => setResults([])}>Clear</Button>}
              <Button onClick={handleExtract} disabled={loading || !urlInput.trim()}>
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Extracting…</> : 'Extract Reading'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {results.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <span className="text-sm font-semibold">Results ({results.filter((r) => !r.loading).length}/{results.length})</span>
            <span className="text-xs text-muted-foreground">
              Avg confidence: {(() => { const done = results.filter((r) => r.confidence != null); if (!done.length) return '—'; return (done.reduce((s, r) => s + (r.confidence ?? 0), 0) / done.length * 100).toFixed(0) + '%'; })()}
            </span>
          </div>
          <div className="max-h-[600px] overflow-y-auto divide-y divide-border">
            {results.map((item) => (
              <div key={item.id}>
                <div className={cn('grid gap-3 px-5 py-3.5 items-center', item.loading && 'opacity-60')}
                  style={{ gridTemplateColumns: '100px 1fr 120px 80px 40px' }}>
                  <div className="w-[100px] h-[66px] rounded-md overflow-hidden bg-muted">
                    <img src={item.url} alt="odometer" className="h-full w-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-[11px] text-faint truncate mb-1">{item.url}</p>
                    {item.error ? <p className="text-xs text-danger">{item.error}</p>
                      : item.loading ? <p className="text-xs text-primary">Processing...</p>
                      : (
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant={item.pipelineMode === 'split' ? 'info' : 'muted'} className="text-[10px]">{item.pipelineMode === 'split' ? 'Split' : 'Single'}</Badge>
                          <span className="text-[11px] text-muted-foreground">{item.provider}</span>
                          {item.latency_ms && <span className="text-[11px] text-faint">{(item.latency_ms / 1000).toFixed(1)}s</span>}
                        </div>
                      )}
                  </div>
                  <div className="text-right">
                    {item.loading ? <span className="text-faint">…</span>
                      : item.odometer_km != null ? <span className="text-lg font-bold font-mono">{item.odometer_km.toLocaleString()}<span className="text-[11px] text-muted-foreground ml-0.5">km</span></span>
                      : <span className="text-sm text-danger">N/A</span>}
                  </div>
                  <div className="text-center">
                    {item.confidence != null && (
                      <Badge variant={item.confidence >= 0.85 ? 'success' : item.confidence >= 0.6 ? 'warning' : 'danger'}>
                        {(item.confidence * 100).toFixed(0)}%
                      </Badge>
                    )}
                  </div>
                  <div className="text-center">
                    {item.loading && <Loader2 className="h-4 w-4 animate-spin text-primary mx-auto" />}
                    {!item.loading && !item.error && !item.needsReview && <CheckCircle className="h-4 w-4 text-success mx-auto" />}
                    {!item.loading && !item.error && item.needsReview && <span title={item.reviewReason}><AlertTriangle className="h-4 w-4 text-warning mx-auto" /></span>}
                    {!item.loading && item.error && <XCircle className="h-4 w-4 text-danger mx-auto" />}
                  </div>
                </div>
                {item.needsReview && item.reviewReason && !item.loading && (
                  <div className="bg-warning-soft border-t border-warning/20 px-5 py-1.5">
                    <span className="text-[11px] font-medium text-warning">Needs review: {item.reviewReason}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {results.length === 0 && (
        <Card>
          <EmptyState icon={<Gauge className="h-10 w-10" />}
            title="No readings yet"
            description="Paste odometer image URLs above and click 'Extract Reading' to get started."
          />
        </Card>
      )}
    </div>
  );
}
