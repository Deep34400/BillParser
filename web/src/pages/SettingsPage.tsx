import { useState, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, ChevronUp, Plus, ChevronRight } from 'lucide-react';
import { api } from '../api/client.js';
import { setUsdToInr } from '../lib/format.js';
import { Toast } from '../components/Toast.js';
import type { ModelPrice, FallbackLevel } from '../types/index.js';
import { cn } from '@/lib/utils.js';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs.js';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card.js';
import { Switch } from '@/components/ui/switch.js';
import { Input } from '@/components/ui/input.js';
import { Label } from '@/components/ui/label.js';
import { Button } from '@/components/ui/button.js';
import { Badge } from '@/components/ui/badge.js';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select.js';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table.js';

const THINKING_OPTIONS = [
  { value: 1024, label: 'Tight — 1,024 tokens', hint: 'Caps slow outliers. Fine for simple, single-page invoices.' },
  { value: 2048, label: 'Balanced — 2,048 tokens (default)', hint: 'Covers every invoice seen so far, including the heaviest.' },
  { value: 4096, label: 'Generous — 4,096 tokens', hint: 'Extra headroom for dense or multi-page invoices. Slower worst case.' },
];

const LEVEL_LABELS = ['Primary', 'Secondary', 'Tertiary'];
const LEVEL_RING = ['ring-[#2E5C8A]', 'ring-[#B45309]', 'ring-[#6B7280]'];
const LEVEL_BG = ['bg-[#EEF3FA]', 'bg-[#FFF6EB]', 'bg-[#F5F5F5]'];
const LEVEL_DOT = ['bg-[#2E5C8A]', 'bg-[#B45309]', 'bg-[#6B7280]'];

interface ProvDef {
  id: string; label: string; models: string[];
  canStructure: boolean; canSingle: boolean; desc: string;
}

const ALL_PROVIDERS: ProvDef[] = [
  { id: 'mistral', label: 'Mistral', models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'pixtral-12b-2409'], canStructure: true, canSingle: true, desc: 'PDF uses OCR+structure; images use Pixtral' },
  { id: 'gemini', label: 'Google Gemini', models: ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'], canStructure: true, canSingle: true, desc: 'Vertex AI + ADC (no API key needed)' },
  { id: 'claude', label: 'Anthropic Claude', models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'], canStructure: true, canSingle: true, desc: 'PDF/image structuring or single call' },
  { id: 'openai', label: 'OpenAI GPT', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'], canStructure: true, canSingle: true, desc: 'Image call (PDF: use Split or Gemini/Claude)' },
  { id: 'azapi', label: 'AzAPI OCR', models: ['azapi-ocr'], canStructure: false, canSingle: true, desc: 'Third-party structured OCR (URL + Token)' },
];

function makeDefaultLevel(index: number): FallbackLevel {
  return {
    label: LEVEL_LABELS[index] ?? `Level ${index + 1}`,
    mode: 'single', provider: 'gemini', model: 'gemini-2.5-flash', enabled: true,
  };
}

function modelOptions(provDef: ProvDef, current?: string): string[] {
  const list = [...provDef.models];
  if (current && !list.includes(current)) list.unshift(current);
  return list;
}

function ModelPicker({ level, accentClass, onChange }: {
  level: FallbackLevel; accentClass: string; onChange: (l: FallbackLevel) => void;
}) {
  const provDef = ALL_PROVIDERS.find((p) => p.id === level.provider) ?? ALL_PROVIDERS[1];
  const structProvDef = ALL_PROVIDERS.find((p) => p.id === (level.structuringProvider ?? 'gemini')) ?? ALL_PROVIDERS[1];

  return (
    <>
      <div className="mb-3.5 flex overflow-hidden rounded-lg border border-border">
        {(['single', 'split'] as const).map((m) => (
          <Button
            key={m}
            type="button"
            variant="ghost"
            className={cn(
              'flex-1 rounded-none h-auto py-2 text-xs font-semibold',
              level.mode === m && cn(accentClass, 'text-white hover:text-white hover:opacity-90'),
            )}
            onClick={() => onChange({ ...level, mode: m })}
          >
            {m === 'single' ? 'Single — 1 API call' : 'Split — 2 API calls'}
          </Button>
        ))}
      </div>

      {level.mode === 'single' ? (
        <div className="flex flex-wrap gap-3">
          <div className="min-w-[160px] flex-1 space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide">Provider</Label>
            <Select value={level.provider} onValueChange={(id) => {
              const def = ALL_PROVIDERS.find((p) => p.id === id);
              const firstModel = id === 'mistral' ? 'pixtral-12b-2409' : (def?.models[0] ?? '');
              onChange({ ...level, provider: id, model: firstModel });
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALL_PROVIDERS.filter((p) => p.canSingle).map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[200px] flex-1 space-y-1.5">
            <Label className="text-[11px] uppercase tracking-wide">Model</Label>
            <Select value={level.model} onValueChange={(v) => onChange({ ...level, model: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {modelOptions(provDef, level.model).map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : (
        <>
          <p className="mb-2.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            Step 1: <strong>Mistral OCR</strong> (mistral-ocr-latest) — always used for extraction
          </p>
          <div className="flex flex-wrap gap-3">
            <div className="min-w-[160px] flex-1 space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide">Step 2 — Structuring Provider</Label>
              <Select value={level.structuringProvider ?? 'gemini'} onValueChange={(id) => {
                const def = ALL_PROVIDERS.find((p) => p.id === id);
                onChange({ ...level, structuringProvider: id, structuringModel: def?.models[0] ?? '' });
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_PROVIDERS.filter((p) => p.canStructure).map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-[200px] flex-1 space-y-1.5">
              <Label className="text-[11px] uppercase tracking-wide">Structuring Model</Label>
              <Select
                value={level.structuringModel ?? structProvDef.models[0]}
                onValueChange={(v) => onChange({ ...level, structuringModel: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {modelOptions(structProvDef, level.structuringModel).map((m) => (
                    <SelectItem key={m} value={m}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function LevelSummary({ level, idx }: { level: FallbackLevel; idx: number }) {
  const text = level.mode === 'single'
    ? `${level.provider}/${level.model}`
    : `Split → ${level.structuringProvider ?? 'gemini'}/${level.structuringModel ?? level.model}`;
  return (
    <Badge className={cn('text-xs font-semibold text-white border-0', LEVEL_DOT[idx] ?? 'bg-muted-foreground')}>
      {idx === 0 ? 'Primary' : level.label}: {text}
    </Badge>
  );
}

export function SettingsPage() {
  const [chain, setChain] = useState<FallbackLevel[]>([]);
  const [savedChain, setSavedChain] = useState<FallbackLevel[]>([]);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [modelPricing, setModelPricing] = useState<Record<string, ModelPrice>>({});
  const [defaultPricing, setDefaultPricing] = useState<Record<string, ModelPrice>>({});
  const [pricingFilter, setPricingFilter] = useState('all');
  const [thinkingBudget, setThinkingBudget] = useState(2048);
  const [savedThinkingBudget, setSavedThinkingBudget] = useState(2048);
  const [fxRate, setFxRate] = useState('');
  const [savedFxRate, setSavedFxRate] = useState<number | null>(null);
  const [ocrPageRate, setOcrPageRate] = useState('');
  const [savingCost, setSavingCost] = useState(false);
  const [savingPricing, setSavingPricing] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [compareProvider, setCompareProvider] = useState('gemini');
  const [compareModel, setCompareModel] = useState('gemini-2.5-flash');
  const [savedCompare, setSavedCompare] = useState({ provider: 'gemini', model: 'gemini-2.5-flash' });
  const [savingCompare, setSavingCompare] = useState(false);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const toggle = (k: string) => setRevealed((p) => ({ ...p, [k]: !p[k] }));

  const load = useCallback(async () => {
    try {
      setLoadError('');
      const s = await api.settings();
      let fc: FallbackLevel[];
      if (s.fallbackChain && s.fallbackChain.length > 0) {
        fc = s.fallbackChain.map((l, i) => ({
          ...l, label: LEVEL_LABELS[i] ?? l.label, enabled: i === 0 ? true : l.enabled,
        }));
      } else {
        const pm = s.pipelineMode === 'split' ? 'split' : 'single';
        fc = pm === 'single'
          ? [{ label: 'Primary', mode: 'single', provider: s.singleProvider || 'gemini', model: s.singleModel || 'gemini-2.5-flash', enabled: true }]
          : [{ label: 'Primary', mode: 'split', provider: 'mistral', model: 'mistral-ocr-latest', structuringProvider: s.structuringProvider || 'gemini', structuringModel: s.structuringModel || 'gemini-2.5-flash', enabled: true }];
      }
      if (fc.length === 0) fc = [makeDefaultLevel(0)];
      setChain(fc); setSavedChain(fc);
      if (s.modelPricing) setModelPricing(s.modelPricing);
      if (s.defaultModelPricing) setDefaultPricing(s.defaultModelPricing);
      if (typeof s.usdToInr === 'number') { setFxRate(String(s.usdToInr)); setSavedFxRate(s.usdToInr); }
      if (typeof s.thinkingBudget === 'number') { setThinkingBudget(s.thinkingBudget); setSavedThinkingBudget(s.thinkingBudget); }
      if (typeof s.mistralOcrPricePer1kPages === 'number') setOcrPageRate(String(s.mistralOcrPricePer1kPages));
      const cp = s.compareProvider || 'gemini';
      const cm = s.compareModel || 'gemini-2.5-flash';
      setCompareProvider(cp);
      setCompareModel(cm);
      setSavedCompare({ provider: cp, model: cm });
      try {
        const { credentials } = await api.revealCreds();
        const cv: Record<string, string> = {};
        for (const p of ALL_PROVIDERS) {
          if (credentials[p.id]?.apiKey) cv[`${p.id}.apiKey`] = credentials[p.id].apiKey;
          if (credentials[p.id]?.endpoint) cv[`${p.id}.endpoint`] = credentials[p.id].endpoint;
        }
        setCreds(cv);
      } catch { /* no reveal */ }
      setLoaded(true);
    } catch (e) {
      const msg = (e as Error).message;
      setLoadError(msg);
      flash(`Load failed: ${msg}`);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const primary = chain[0] ?? makeDefaultLevel(0);
  const fallbacks = chain.slice(1);
  const dirty = JSON.stringify(chain) !== JSON.stringify(savedChain);
  const savedPrimary = savedChain[0];
  const savedFallbacks = savedChain.slice(1).filter((l) => l.enabled);
  const costDirty = thinkingBudget !== savedThinkingBudget || (Number(fxRate) > 0 && Number(fxRate) !== savedFxRate);
  const compareDirty = compareProvider !== savedCompare.provider || compareModel !== savedCompare.model;
  const compareProvDef = ALL_PROVIDERS.find((p) => p.id === compareProvider) ?? ALL_PROVIDERS[1];

  const handleSave = async () => {
    setSaving(true);
    try {
      const labeled = chain.map((l, i) => ({
        ...l, label: LEVEL_LABELS[i] ?? `Level ${i + 1}`, enabled: i === 0 ? true : l.enabled,
      }));
      const p = labeled[0];
      await api.saveSettings({
        fallbackChain: labeled,
        pipelineMode: p.mode,
        singleProvider: p.mode === 'single' ? p.provider : undefined,
        singleModel: p.mode === 'single' ? p.model : undefined,
        structuringProvider: p.mode === 'split' ? (p.structuringProvider ?? 'gemini') : undefined,
        structuringModel: p.mode === 'split' ? (p.structuringModel ?? 'gemini-2.5-flash') : undefined,
      });
      setSavedChain(labeled); setChain(labeled);
      const fbCount = labeled.slice(1).filter((l) => l.enabled).length;
      flash(fbCount > 0 ? `Saved — Primary + ${fbCount} fallback${fbCount > 1 ? 's' : ''}` : 'Saved — Primary only');
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
    finally { setSaving(false); }
  };

  const handleSaveCompare = async () => {
    setSavingCompare(true);
    try {
      await api.saveSettings({ compareProvider, compareModel });
      setSavedCompare({ provider: compareProvider, model: compareModel });
      flash(`Compare model saved — ${compareProvider} / ${compareModel}`);
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
    finally { setSavingCompare(false); }
  };

  const handleSaveCreds = async (provId: string) => {
    const val = creds[`${provId}.apiKey`];
    if (!val) { flash('Enter an API key / token first'); return; }
    const payload: Record<string, string> = { apiKey: val };
    const ep = creds[`${provId}.endpoint`];
    if (ep) payload.endpoint = ep;
    try { await api.saveCreds(provId, payload); await load(); flash(`${provId} credentials saved`); }
    catch (e) { flash(`Error: ${(e as Error).message}`); }
  };

  const handleClearCreds = async (provId: string) => {
    try {
      await api.clearCreds(provId);
      setCreds((p) => { const n = { ...p }; delete n[`${provId}.apiKey`]; delete n[`${provId}.endpoint`]; return n; });
      await load(); flash(`${provId} credentials cleared`);
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
  };

  const updatePrimary = (l: FallbackLevel) => setChain((c) => { const n = [...c]; n[0] = { ...l, label: 'Primary', enabled: true }; return n; });
  const updateFallback = (fi: number, l: FallbackLevel) => setChain((c) => {
    const n = [...c]; const idx = fi + 1;
    n[idx] = { ...l, label: LEVEL_LABELS[idx] ?? `Level ${idx + 1}` }; return n;
  });
  const removeFallback = (fi: number) => setChain((c) => c.filter((_, j) => j !== fi + 1));
  const addFallback = () => {
    if (chain.length >= 3) { flash('Maximum 2 fallback levels.'); return; }
    setChain((c) => [...c, makeDefaultLevel(c.length)]);
  };
  const moveFallback = (fi: number, dir: -1 | 1) => setChain((c) => {
    const n = [...c]; const i = fi + 1; const j = i + dir;
    if (j < 1 || j >= n.length) return c;
    [n[i], n[j]] = [n[j], n[i]];
    return n.map((l, idx) => ({ ...l, label: LEVEL_LABELS[idx] ?? l.label }));
  });

  const handlePricingChange = (model: string, field: 'inputPer1M' | 'outputPer1M', val: string) => {
    const n = parseFloat(val); if (Number.isNaN(n) && val !== '') return;
    setModelPricing((prev) => ({ ...prev, [model]: { ...prev[model], [field]: val === '' ? 0 : n } }));
  };

  const handleSaveCost = async () => {
    const rate = Number(fxRate);
    if (!(rate > 0)) { flash('Enter a USD→INR rate greater than 0'); return; }
    setSavingCost(true);
    try {
      await api.saveSettings({
        usdToInr: rate, thinkingBudget,
        ...(ocrPageRate !== '' && Number(ocrPageRate) >= 0 ? { mistralOcrPricePer1kPages: Number(ocrPageRate) } : {}),
      });
      setSavedFxRate(rate); setSavedThinkingBudget(thinkingBudget); setUsdToInr(rate);
      flash('Cost settings saved');
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
    finally { setSavingCost(false); }
  };

  const handleSavePricing = async () => {
    setSavingPricing(true);
    try {
      const overrides: Record<string, ModelPrice> = {};
      for (const [model, price] of Object.entries(modelPricing)) {
        const def = defaultPricing[model];
        if (!def || price.inputPer1M !== def.inputPer1M || price.outputPer1M !== def.outputPer1M) overrides[model] = price;
      }
      await api.saveSettings({ modelPricing: overrides }); flash('Pricing saved');
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
    finally { setSavingPricing(false); }
  };

  const handleResetPricing = (model: string) => {
    const def = defaultPricing[model];
    if (def) setModelPricing((prev) => ({ ...prev, [model]: { ...def } }));
  };

  const providerGroups = useMemo(() => [
    { label: 'All', id: 'all', models: Object.keys(modelPricing) },
    ...ALL_PROVIDERS.map((p) => ({ label: p.label, id: p.id, models: p.models.concat(p.id === 'mistral' ? ['mistral-ocr-latest'] : []) })),
  ], [modelPricing]);

  const filteredModels = useMemo(() => {
    if (pricingFilter === 'all') return Object.keys(modelPricing).sort();
    const group = providerGroups.find((g) => g.id === pricingFilter);
    return group ? group.models.filter((m) => m in modelPricing).sort() : Object.keys(modelPricing).sort();
  }, [pricingFilter, modelPricing, providerGroups]);

  if (!loaded) {
    return (
      <div className="max-w-3xl px-7 py-10 text-center space-y-3">
        {loadError ? (
          <>
            <p className="text-sm text-destructive">Could not open settings: {loadError}</p>
            <Button type="button" variant="outline" onClick={() => void load()}>Retry</Button>
          </>
        ) : (
          <p className="text-muted-foreground">Loading settings...</p>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-3xl px-7 py-6 font-sans">
      <h1 className="font-heading text-2xl font-extrabold">Settings</h1>
      <p className="mt-0.5 mb-6 text-sm text-muted-foreground">
        Set your Primary OCR model, then optionally add fallback models if Primary fails.
      </p>

      <Tabs defaultValue="pipeline">
        <TabsList className="mb-4">
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="credentials">Credentials</TabsTrigger>
          <TabsTrigger value="ocr-config">OCR Config</TabsTrigger>
        </TabsList>

        {/* ─── Pipeline ─── */}
        <TabsContent value="pipeline" className="space-y-4">
          <Card className="border-[#c5d8f0] bg-gradient-to-br from-[#EEF3FA] to-[#F6F9FE]">
            <CardHeader className="pb-2">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wider text-primary">
                Currently Active
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2">
              {savedPrimary && <LevelSummary level={savedPrimary} idx={0} />}
              {savedFallbacks.map((l, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">→ if fail</span>
                  <LevelSummary level={l} idx={i + 1} />
                </div>
              ))}
              {savedFallbacks.length === 0 && (
                <span className="text-xs text-muted-foreground">No fallback configured</span>
              )}
            </CardContent>
          </Card>

          <Card className={cn('ring-2', LEVEL_RING[0], LEVEL_BG[0])}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Primary Model</CardTitle>
                <Badge variant={dirty ? 'warning' : 'info'}>{dirty ? 'Unsaved' : 'Required'}</Badge>
              </div>
              <CardDescription>
                This model runs first on every invoice. Change provider/model freely — independent of fallbacks below.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex items-center gap-2.5">
                <div className={cn('flex h-8 w-8 items-center justify-center rounded-full text-sm font-extrabold text-white', LEVEL_DOT[0])}>1</div>
                <div className="flex-1">
                  <p className="text-sm font-bold">Primary</p>
                  <p className="text-[11px] text-muted-foreground">
                    {primary.mode === 'single'
                      ? `${primary.provider} / ${primary.model}`
                      : `Split → ${primary.structuringProvider ?? 'gemini'} / ${primary.structuringModel ?? primary.model}`}
                  </p>
                </div>
                <Badge variant="success">ALWAYS ON</Badge>
              </div>
              <ModelPicker level={primary} accentClass={LEVEL_DOT[0]} onChange={updatePrimary} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Fallback Models</CardTitle>
                <Badge variant="muted">
                  {fallbacks.length === 0 ? 'Optional' : `${fallbacks.filter((l) => l.enabled).length} enabled`}
                </Badge>
              </div>
              <CardDescription>
                Tried only when Primary fails (API error) or reconciliation does not match.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {fallbacks.length === 0 && (
                <p className="rounded-lg border border-dashed bg-muted/30 py-4 text-center text-sm text-muted-foreground">
                  No fallback models yet. OCR uses Primary only.
                </p>
              )}
              {fallbacks.map((level, fi) => {
                const idx = fi + 1;
                return (
                  <Card key={idx} className={cn(
                    'ring-2 transition-opacity',
                    level.enabled ? cn(LEVEL_RING[idx], LEVEL_BG[idx]) : 'opacity-55 ring-border bg-muted/20',
                  )}>
                    <CardContent className="pt-4">
                      <div className="mb-3.5 flex items-center gap-2">
                        <div className={cn('flex h-8 w-8 items-center justify-center rounded-full text-sm font-extrabold text-white', LEVEL_DOT[idx])}>{idx + 1}</div>
                        <div className="flex-1">
                          <p className="text-sm font-bold">{LEVEL_LABELS[idx]}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {level.mode === 'single'
                              ? `${level.provider} / ${level.model}`
                              : `Split → ${level.structuringProvider ?? 'gemini'} / ${level.structuringModel ?? level.model}`}
                          </p>
                        </div>
                        <div className="flex gap-0.5">
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={fi === 0} onClick={() => moveFallback(fi, -1)}>
                            <ChevronUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={fi === fallbacks.length - 1} onClick={() => moveFallback(fi, 1)}>
                            <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <Switch checked={level.enabled} onCheckedChange={(v) => updateFallback(fi, { ...level, enabled: v })} />
                      </div>
                      <ModelPicker level={{ ...level, label: LEVEL_LABELS[idx] }} accentClass={LEVEL_DOT[idx]} onChange={(l) => updateFallback(fi, l)} />
                      <div className="mt-3 text-right">
                        <Button type="button" variant="link" className="h-auto p-0 text-xs text-destructive" onClick={() => removeFallback(fi)}>
                          Remove fallback
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
              {chain.length < 3 && (
                <Button type="button" variant="outline" size="sm" className="border-dashed" onClick={addFallback}>
                  <Plus className="h-4 w-4" /> Add fallback model
                </Button>
              )}
            </CardContent>
          </Card>

          <div className={cn(
            'flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3.5',
            dirty ? 'border-warning/40 bg-warning-soft' : 'border-border bg-card',
          )}>
            <Button disabled={saving || !dirty} onClick={() => void handleSave()}>
              {saving ? 'Saving...' : 'Save Pipeline'}
            </Button>
            <span className={cn('text-xs font-semibold', dirty ? 'text-warning' : 'text-muted-foreground')}>
              {dirty ? 'Unsaved changes — Primary and fallbacks save together' : 'All changes saved'}
            </span>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Compare model</CardTitle>
                <Badge variant={compareDirty ? 'warning' : 'info'}>{compareDirty ? 'Unsaved' : 'Invoice compare'}</Badge>
              </div>
              <CardDescription>
                Used only on Compare — leftover name match, then a separate summary prompt. Gemini is the default (Vertex ADC, no API key). Totals stay rule-based.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <div className="min-w-[160px] flex-1 space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wide">Provider</Label>
                  <Select value={compareProvider} onValueChange={(id) => {
                    const def = ALL_PROVIDERS.find((p) => p.id === id);
                    setCompareProvider(id);
                    setCompareModel(id === 'mistral' ? 'mistral-small-latest' : (def?.models[0] ?? 'gemini-2.5-flash'));
                  }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ALL_PROVIDERS.filter((p) => p.id === 'gemini' || p.id === 'openai' || p.id === 'mistral').map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-[200px] flex-1 space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wide">Model</Label>
                  <Select value={compareModel} onValueChange={setCompareModel}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {modelOptions(compareProvDef, compareModel).map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button disabled={savingCompare || !compareDirty} onClick={() => void handleSaveCompare()}>
                  {savingCompare ? 'Saving...' : 'Save compare model'}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {savedCompare.provider} / {savedCompare.model}
                </span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <button
              type="button"
              className="flex w-full items-center gap-2 px-6 py-4 text-left"
              onClick={() => setHowItWorksOpen((o) => !o)}
            >
              <ChevronRight className={cn('h-4 w-4 text-muted-foreground transition-transform', howItWorksOpen && 'rotate-90')} />
              <span className="text-sm font-bold">How it Works</span>
            </button>
            {howItWorksOpen && (
              <CardContent className="border-t pt-4 text-sm leading-relaxed text-muted-foreground">
                <strong className="text-foreground">Primary</strong> — always runs first. Change it anytime without touching fallbacks.<br />
                <strong className="text-foreground">Fallback</strong> — optional Secondary / Tertiary. Used only if Primary fails or totals don&apos;t match.<br /><br />
                Match → <span className="font-semibold text-success">OCR_COMPLETED</span>. All fail reconcile → best attempt as{' '}
                <span className="font-semibold text-warning">NEED_REVIEW</span>. All crash →{' '}
                <span className="font-semibold text-destructive">FAILED</span>.<br /><br />
                <strong className="text-foreground">Compare</strong> — separate from OCR. Rules match codes/names first. AI only pairs leftovers, then a second prompt writes the reviewer note. Validation drops weak pairs. Money never comes from the model.
              </CardContent>
            )}
          </Card>
        </TabsContent>

        {/* ─── Pricing ─── */}
        <TabsContent value="pricing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Model Pricing</CardTitle>
              <CardDescription>Per-model token pricing for cost calculation. Edit to override defaults.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-3.5 flex flex-wrap gap-1.5">
                {providerGroups.map((g) => (
                  <Button
                    key={g.id}
                    type="button"
                    size="sm"
                    variant={pricingFilter === g.id ? 'default' : 'outline'}
                    className="h-7 rounded-full text-[11px]"
                    onClick={() => setPricingFilter(g.id)}
                  >
                    {g.label}
                  </Button>
                ))}
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] uppercase">Model</TableHead>
                    <TableHead className="w-[120px] text-right text-[10px] uppercase">Input $/1M</TableHead>
                    <TableHead className="w-[120px] text-right text-[10px] uppercase">Output $/1M</TableHead>
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredModels.map((model) => {
                    const price = modelPricing[model];
                    const def = defaultPricing[model];
                    const isModified = def && (price?.inputPer1M !== def.inputPer1M || price?.outputPer1M !== def.outputPer1M);
                    if (!price) return null;
                    return (
                      <TableRow key={model}>
                        <TableCell className="py-1.5 text-xs font-semibold">
                          {model}
                          {isModified && <Badge variant="warning" className="ml-1.5 text-[9px]">CUSTOM</Badge>}
                        </TableCell>
                        <TableCell className="py-1 text-right">
                          <Input type="number" step="0.01" min="0" className="ml-auto h-8 w-[90px] text-right text-xs"
                            value={price.inputPer1M} onChange={(e) => handlePricingChange(model, 'inputPer1M', e.target.value)} />
                        </TableCell>
                        <TableCell className="py-1 text-right">
                          <Input type="number" step="0.01" min="0" className="ml-auto h-8 w-[90px] text-right text-xs"
                            value={price.outputPer1M} onChange={(e) => handlePricingChange(model, 'outputPer1M', e.target.value)} />
                        </TableCell>
                        <TableCell className="py-1 text-center">
                          {isModified && (
                            <Button type="button" variant="link" className="h-auto p-0 text-[10px]" onClick={() => handleResetPricing(model)}>
                              Reset
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <Button className="mt-3.5" disabled={savingPricing} onClick={() => void handleSavePricing()}>
                {savingPricing ? 'Saving...' : 'Save Pricing'}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Credentials ─── */}
        <TabsContent value="credentials" className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Each provider needs an API key (except Gemini which uses ADC).
          </p>
          {ALL_PROVIDERS.map((prov) => {
            const keyField = `${prov.id}.apiKey`;
            const epField = `${prov.id}.endpoint`;
            const needsEndpoint = prov.id === 'azapi';
            const shown = !!revealed[keyField];
            const hasKey = !!creds[keyField];
            const isActive = chain.some((l) => l.enabled && (
              l.provider === prov.id || l.structuringProvider === prov.id || (l.mode === 'split' && prov.id === 'mistral')
            ));
            const isGeminiAdc = prov.id === 'gemini';
            return (
              <Card key={prov.id} className={cn(
                'transition-opacity',
                !isActive && 'opacity-45',
                isActive && !isGeminiAdc && !hasKey && 'border-warning/50',
              )}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2">
                    <span className={cn('h-2 w-2 rounded-full', isGeminiAdc || hasKey ? 'bg-success' : 'bg-border')} />
                    <span className="text-sm font-bold">{prov.label}</span>
                    <Badge variant={isGeminiAdc || hasKey ? 'success' : 'muted'}>
                      {isGeminiAdc ? 'ADC' : hasKey ? 'Configured' : 'No key'}
                    </Badge>
                    {isActive && <Badge className="ml-auto">IN USE</Badge>}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{prov.desc}</p>
                  {!isGeminiAdc && (
                    <div className="mt-2.5 space-y-2">
                      {needsEndpoint && (
                        <Input type="text" placeholder={`${prov.label} endpoint URL`} autoComplete="off"
                          value={creds[epField] ?? ''} onChange={(e) => setCreds((p) => ({ ...p, [epField]: e.target.value }))} />
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <Input type={shown ? 'text' : 'password'} className="flex-1 min-w-[180px]"
                          placeholder={needsEndpoint ? `${prov.label} token` : `${prov.label} API key`} autoComplete="off"
                          value={creds[keyField] ?? ''} onChange={(e) => setCreds((p) => ({ ...p, [keyField]: e.target.value }))} />
                        <Button type="button" variant="outline" size="sm" onClick={() => toggle(keyField)}>
                          {shown ? 'Hide' : 'Show'}
                        </Button>
                        <Button type="button" size="sm" onClick={() => void handleSaveCreds(prov.id)}>Save</Button>
                        {hasKey && (
                          <Button type="button" variant="outline" size="sm" className="text-destructive border-destructive/30"
                            onClick={() => void handleClearCreds(prov.id)}>Clear</Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

        {/* ─── OCR Config ─── */}
        <TabsContent value="ocr-config" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cost &amp; Currency</CardTitle>
              <CardDescription>How extraction cost is priced and displayed</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-1.5">
                <Label className="text-[11px] uppercase tracking-wide">USD → INR rate</Label>
                <Input type="number" step="0.01" min="0" value={fxRate} onChange={(e) => setFxRate(e.target.value)}
                  placeholder="96" className="w-40" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Model prices are quoted in USD; this converts them for display.
                  {savedFxRate != null && <> Currently <strong>₹{savedFxRate}</strong> per $1.</>}
                  {' '}Each invoice stores the rate in force when it was processed.
                </p>
              </div>

              <div className="space-y-1.5 border-t border-border pt-4">
                <Label className="text-[11px] uppercase tracking-wide">Reasoning limit</Label>
                <Select value={String(thinkingBudget)} onValueChange={(v) => setThinkingBudget(Number(v))}>
                  <SelectTrigger className="max-w-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {THINKING_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {THINKING_OPTIONS.find((o) => o.value === thinkingBudget)?.hint}
                  {' '}Models use only what they need — typically 150–800 tokens — up to this cap.
                </p>
              </div>

              <div className="space-y-1.5 border-t border-border pt-4">
                <Label className="text-[11px] uppercase tracking-wide">Mistral OCR — $ per 1,000 pages</Label>
                <Input type="number" step="0.01" min="0" value={ocrPageRate} onChange={(e) => setOcrPageRate(e.target.value)}
                  placeholder="4" className="w-40" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Mistral bills OCR per page, not per token. Used only when a fallback level runs Split mode.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <Button disabled={savingCost || !costDirty} onClick={() => void handleSaveCost()}>
                  {savingCost ? 'Saving...' : 'Save cost settings'}
                </Button>
                {costDirty && <span className="text-xs font-semibold text-warning">Unsaved changes</span>}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Toast message={toast} />
    </div>
  );
}
