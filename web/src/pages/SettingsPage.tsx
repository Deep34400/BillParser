import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api/client.js';
import { T } from '../theme.js';
import { Toast } from '../components/Toast.js';
import type { ModelPrice, FallbackLevel } from '../types/index.js';

/* ─── Shared styles ───────────────────────────────────────── */

const card: React.CSSProperties = {
  background: T.panel, border: `1px solid ${T.border}`,
  borderRadius: 12, padding: '20px 24px', marginBottom: 16,
};
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, color: T.muted,
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em',
};
const inp: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: `1px solid ${T.border}`,
  borderRadius: 6, fontSize: 13, fontFamily: T.font, color: T.text,
  background: T.bg, boxSizing: 'border-box',
};
const sel: React.CSSProperties = { ...inp, cursor: 'pointer' };
const btnP: React.CSSProperties = {
  background: T.accent, color: '#fff', border: 'none', borderRadius: 8,
  padding: '9px 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
};
const btnS: React.CSSProperties = {
  background: 'transparent', color: T.muted, border: `1px solid ${T.border}`,
  borderRadius: 8, padding: '9px 20px', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: T.font,
};
const dot = (ok: boolean): React.CSSProperties => ({
  width: 8, height: 8, borderRadius: '50%', background: ok ? T.green : T.border,
  display: 'inline-block', marginRight: 6, flexShrink: 0,
});

/* ─── Collapsible section ─────────────────────────────────── */

function Section({ title, subtitle, defaultOpen = true, badge: badgeText, children }: {
  title: string; subtitle?: string; defaultOpen?: boolean; badge?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 24 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0',
          fontFamily: T.font, textAlign: 'left',
        }}
      >
        <span style={{
          fontSize: 18, color: T.muted, width: 20, textAlign: 'center',
          transition: 'transform 0.2s', transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
        }}>
          &#9654;
        </span>
        <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{title}</span>
        {badgeText && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 10px', borderRadius: 12,
            background: T.accentSoft, color: T.accent, letterSpacing: '0.03em',
          }}>{badgeText}</span>
        )}
        {subtitle && <span style={{ fontSize: 12, color: T.muted, marginLeft: 'auto' }}>{subtitle}</span>}
      </button>
      {open && <div style={{ paddingLeft: 30, paddingTop: 4 }}>{children}</div>}
    </div>
  );
}

/* ─── Provider definitions ────────────────────────────────── */

interface ProvDef {
  id: string; label: string; models: string[];
  canStructure: boolean; canSingle: boolean; desc: string;
}

const ALL_PROVIDERS: ProvDef[] = [
  { id: 'mistral', label: 'Mistral', models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'pixtral-12b-2409'], canStructure: true, canSingle: true, desc: 'PDF uses OCR+structure; images use Pixtral' },
  { id: 'gemini', label: 'Google Gemini', models: ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'], canStructure: true, canSingle: true, desc: 'Vertex AI + ADC (no API key needed)' },
  { id: 'claude', label: 'Anthropic Claude', models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'], canStructure: true, canSingle: true, desc: 'PDF/image structuring or single call' },
  { id: 'openai', label: 'OpenAI GPT', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'], canStructure: true, canSingle: true, desc: 'Image call (PDF: use Split or Gemini/Claude)' },
];

const LEVEL_LABELS = ['Primary', 'Secondary', 'Tertiary'];
const LEVEL_COLORS = ['#2E5C8A', '#B45309', '#6B7280'];
const LEVEL_BG = ['#EEF3FA', '#FFF6EB', '#F5F5F5'];

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

/* ─── Model picker (shared by Primary + Fallback) ─────────── */

function ModelPicker({
  level, accent, onChange,
}: {
  level: FallbackLevel; accent: string; onChange: (l: FallbackLevel) => void;
}) {
  const provDef = ALL_PROVIDERS.find((p) => p.id === level.provider) ?? ALL_PROVIDERS[1];
  const structProvDef = ALL_PROVIDERS.find((p) => p.id === (level.structuringProvider ?? 'gemini')) ?? ALL_PROVIDERS[1];

  return (
    <>
      <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: `1px solid ${T.border}`, marginBottom: 14 }}>
        {(['single', 'split'] as const).map((m) => (
          <button key={m} type="button" onClick={() => onChange({ ...level, mode: m })}
            style={{
              flex: 1, padding: '9px 12px', fontSize: 12, fontWeight: 600,
              border: 'none', cursor: 'pointer', fontFamily: T.font,
              background: level.mode === m ? accent : '#fff',
              color: level.mode === m ? '#fff' : T.text,
              transition: 'all 0.15s',
            }}>
            {m === 'single' ? 'Single — 1 API call' : 'Split — 2 API calls'}
          </button>
        ))}
      </div>

      {level.mode === 'single' ? (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={lbl}>Provider</div>
            <select style={sel} value={level.provider} onChange={(e) => {
              const id = e.target.value;
              const def = ALL_PROVIDERS.find((p) => p.id === id);
              const firstModel = id === 'mistral' ? 'pixtral-12b-2409' : (def?.models[0] ?? '');
              onChange({ ...level, provider: id, model: firstModel });
            }}>
              {ALL_PROVIDERS.filter((p) => p.canSingle).map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={lbl}>Model</div>
            <select style={sel} value={level.model} onChange={(e) => onChange({ ...level, model: e.target.value })}>
              {modelOptions(provDef, level.model).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>
      ) : (
        <>
          <div style={{
            padding: '8px 12px', borderRadius: 6, background: '#f0f0ed',
            fontSize: 12, color: T.muted, marginBottom: 10,
          }}>
            Step 1: <strong>Mistral OCR</strong> (mistral-ocr-latest) — always used for extraction
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={lbl}>Step 2 — Structuring Provider</div>
              <select style={sel} value={level.structuringProvider ?? 'gemini'} onChange={(e) => {
                const id = e.target.value;
                const def = ALL_PROVIDERS.find((p) => p.id === id);
                onChange({ ...level, structuringProvider: id, structuringModel: def?.models[0] ?? '' });
              }}>
                {ALL_PROVIDERS.filter((p) => p.canStructure).map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={lbl}>Structuring Model</div>
              <select
                style={sel}
                value={level.structuringModel ?? structProvDef.models[0]}
                onChange={(e) => onChange({ ...level, structuringModel: e.target.value })}
              >
                {modelOptions(structProvDef, level.structuringModel).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ─── Main SettingsPage ───────────────────────────────────── */

export function SettingsPage() {
  const [chain, setChain] = useState<FallbackLevel[]>([]);
  const [savedChain, setSavedChain] = useState<FallbackLevel[]>([]);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modelPricing, setModelPricing] = useState<Record<string, ModelPrice>>({});
  const [defaultPricing, setDefaultPricing] = useState<Record<string, ModelPrice>>({});
  const [pricingFilter, setPricingFilter] = useState<string>('all');
  const [savingPricing, setSavingPricing] = useState(false);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const toggle = (k: string) => setRevealed((p) => ({ ...p, [k]: !p[k] }));

  const load = useCallback(async () => {
    try {
      const s = await api.settings();
      let fc: FallbackLevel[];
      if (s.fallbackChain && s.fallbackChain.length > 0) {
        fc = s.fallbackChain.map((l, i) => ({
          ...l,
          label: LEVEL_LABELS[i] ?? l.label,
          enabled: i === 0 ? true : l.enabled, // Primary always on
        }));
      } else {
        const pm = s.pipelineMode === 'split' ? 'split' : 'single';
        if (pm === 'single') {
          fc = [{ label: 'Primary', mode: 'single', provider: s.singleProvider || 'gemini', model: s.singleModel || 'gemini-2.5-flash', enabled: true }];
        } else {
          fc = [{ label: 'Primary', mode: 'split', provider: 'mistral', model: 'mistral-ocr-latest', structuringProvider: s.structuringProvider || 'gemini', structuringModel: s.structuringModel || 'gemini-2.5-flash', enabled: true }];
        }
      }
      if (fc.length === 0) fc = [makeDefaultLevel(0)];
      setChain(fc); setSavedChain(fc);
      if (s.modelPricing) setModelPricing(s.modelPricing);
      if (s.defaultModelPricing) setDefaultPricing(s.defaultModelPricing);
      try {
        const { credentials } = await api.revealCreds();
        const cv: Record<string, string> = {};
        for (const p of ALL_PROVIDERS) {
          if (credentials[p.id]?.apiKey) cv[`${p.id}.apiKey`] = credentials[p.id].apiKey;
        }
        setCreds(cv);
      } catch { /* no reveal */ }
      setLoaded(true);
    } catch (e) { flash(`Load failed: ${(e as Error).message}`); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const primary = chain[0] ?? makeDefaultLevel(0);
  const fallbacks = chain.slice(1);
  const dirty = JSON.stringify(chain) !== JSON.stringify(savedChain);

  const handleSave = async () => {
    setSaving(true);
    try {
      const labeled = chain.map((l, i) => ({
        ...l,
        label: LEVEL_LABELS[i] ?? `Level ${i + 1}`,
        enabled: i === 0 ? true : l.enabled,
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
      flash(fbCount > 0
        ? `Saved — Primary + ${fbCount} fallback${fbCount > 1 ? 's' : ''}`
        : 'Saved — Primary only');
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
    finally { setSaving(false); }
  };

  const handleSaveCreds = async (provId: string) => {
    const val = creds[`${provId}.apiKey`];
    if (!val) { flash('Enter an API key first'); return; }
    try { await api.saveCreds(provId, { apiKey: val }); await load(); flash(`${provId} key saved`); }
    catch (e) { flash(`Error: ${(e as Error).message}`); }
  };
  const handleClearCreds = async (provId: string) => {
    try { await api.clearCreds(provId); setCreds((p) => { const n = { ...p }; delete n[`${provId}.apiKey`]; return n; }); await load(); flash(`${provId} key cleared`); }
    catch (e) { flash(`Error: ${(e as Error).message}`); }
  };

  const updatePrimary = (l: FallbackLevel) => {
    setChain((c) => {
      const n = [...c];
      n[0] = { ...l, label: 'Primary', enabled: true };
      return n;
    });
  };

  const updateFallback = (fi: number, l: FallbackLevel) => {
    setChain((c) => {
      const n = [...c];
      const idx = fi + 1;
      n[idx] = { ...l, label: LEVEL_LABELS[idx] ?? `Level ${idx + 1}` };
      return n;
    });
  };

  const removeFallback = (fi: number) => {
    setChain((c) => c.filter((_, j) => j !== fi + 1));
  };

  const addFallback = () => {
    if (chain.length >= 3) { flash('Maximum 2 fallback levels.'); return; }
    setChain((c) => [...c, makeDefaultLevel(c.length)]);
  };

  const moveFallback = (fi: number, dir: -1 | 1) => {
    setChain((c) => {
      const n = [...c];
      const i = fi + 1;
      const j = i + dir;
      if (j < 1 || j >= n.length) return c; // never swap with Primary
      [n[i], n[j]] = [n[j], n[i]];
      return n.map((l, idx) => ({ ...l, label: LEVEL_LABELS[idx] ?? l.label }));
    });
  };

  const handlePricingChange = (model: string, field: 'inputPer1M' | 'outputPer1M', val: string) => {
    const n = parseFloat(val); if (Number.isNaN(n) && val !== '') return;
    setModelPricing((prev) => ({ ...prev, [model]: { ...prev[model], [field]: val === '' ? 0 : n } }));
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
  const handleResetPricing = (model: string) => { const def = defaultPricing[model]; if (def) setModelPricing((prev) => ({ ...prev, [model]: { ...def } })); };

  const providerGroups = useMemo(() => [
    { label: 'All', id: 'all', models: Object.keys(modelPricing) },
    ...ALL_PROVIDERS.map((p) => ({ label: p.label, id: p.id, models: p.models.concat(p.id === 'mistral' ? ['mistral-ocr-latest'] : []) })),
  ], [modelPricing]);

  const filteredModels = useMemo(() => {
    if (pricingFilter === 'all') return Object.keys(modelPricing).sort();
    const group = providerGroups.find((g) => g.id === pricingFilter);
    return group ? group.models.filter((m) => m in modelPricing).sort() : Object.keys(modelPricing).sort();
  }, [pricingFilter, modelPricing, providerGroups]);

  if (!loaded) return <div style={{ padding: 40, fontFamily: T.font, color: T.muted, textAlign: 'center' }}>Loading settings...</div>;

  const savedPrimary = savedChain[0];
  const savedFallbacks = savedChain.slice(1).filter((l) => l.enabled);

  return (
    <div style={{ padding: '24px 30px', fontFamily: T.font, color: T.text, maxWidth: 760 }}>
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 2px', fontFamily: T.heading }}>Settings</h1>
      <p style={{ fontSize: 13, color: T.muted, margin: '0 0 28px' }}>
        Set your Primary OCR model, then optionally add fallback models if Primary fails.
      </p>

      {/* ═══ Active pipeline summary ═══ */}
      <div style={{
        ...card, padding: '18px 22px',
        background: 'linear-gradient(135deg, #EEF3FA 0%, #F6F9FE 100%)',
        borderColor: '#c5d8f0',
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.accent, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
          Currently Active
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {savedPrimary && (
            <span style={{
              fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 8,
              background: LEVEL_COLORS[0], color: '#fff',
            }}>
              Primary: {savedPrimary.mode === 'single'
                ? `${savedPrimary.provider}/${savedPrimary.model}`
                : `Split → ${savedPrimary.structuringProvider ?? 'gemini'}/${savedPrimary.structuringModel ?? savedPrimary.model}`}
            </span>
          )}
          {savedFallbacks.map((l, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: T.muted }}>→ if fail</span>
              <span style={{
                fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8,
                background: LEVEL_COLORS[i + 1] ?? T.muted, color: '#fff',
              }}>
                {l.label}: {l.mode === 'single' ? `${l.provider}/${l.model}` : `Split → ${l.structuringProvider ?? 'gemini'}`}
              </span>
            </div>
          ))}
          {savedFallbacks.length === 0 && (
            <span style={{ fontSize: 12, color: T.muted }}>No fallback configured</span>
          )}
        </div>
      </div>

      {/* ═══ PRIMARY (always editable, cannot remove) ═══ */}
      <Section title="Primary Model" badge={dirty ? 'Unsaved' : 'Required'} defaultOpen={true}>
        <p style={{ fontSize: 12, color: T.muted, margin: '0 0 12px', lineHeight: 1.5 }}>
          This model runs first on every invoice. Change provider/model freely — independent of fallbacks below.
        </p>
        <div style={{
          background: LEVEL_BG[0],
          border: `1.5px solid ${LEVEL_COLORS[0]}`,
          borderRadius: 12, padding: '18px 20px', marginBottom: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', background: LEVEL_COLORS[0], color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, fontWeight: 800,
            }}>1</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Primary</div>
              <div style={{ fontSize: 11, color: T.muted }}>
                {primary.mode === 'single'
                  ? `${primary.provider} / ${primary.model}`
                  : `Split → ${primary.structuringProvider ?? 'gemini'} / ${primary.structuringModel ?? primary.model}`}
              </div>
            </div>
            <span style={{
              marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '3px 10px',
              borderRadius: 10, background: T.successSoft, color: T.green,
            }}>ALWAYS ON</span>
          </div>
          <ModelPicker level={primary} accent={LEVEL_COLORS[0]} onChange={updatePrimary} />
        </div>
      </Section>

      {/* ═══ FALLBACK (separate section) ═══ */}
      <Section
        title="Fallback Models"
        badge={fallbacks.length === 0 ? 'Optional' : `${fallbacks.filter((l) => l.enabled).length} enabled`}
        defaultOpen={true}
      >
        <p style={{ fontSize: 12, color: T.muted, margin: '0 0 12px', lineHeight: 1.5 }}>
          Tried only when Primary fails (API error) or reconciliation does not match. Each fallback is independent of Primary.
        </p>

        {fallbacks.length === 0 && (
          <div style={{
            ...card, padding: '16px 18px', background: '#fafafa',
            textAlign: 'center', color: T.muted, fontSize: 13,
          }}>
            No fallback models yet. OCR uses Primary only.
          </div>
        )}

        {fallbacks.map((level, fi) => {
          const idx = fi + 1;
          const color = LEVEL_COLORS[idx] ?? T.muted;
          const bg = LEVEL_BG[idx] ?? '#F5F5F5';
          return (
            <div key={idx} style={{
              background: level.enabled ? bg : '#fafafa',
              border: `1.5px solid ${level.enabled ? color : T.border}`,
              borderRadius: 12, padding: '18px 20px', marginBottom: 10,
              opacity: level.enabled ? 1 : 0.55,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', background: color, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 14, fontWeight: 800,
                }}>{idx + 1}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{LEVEL_LABELS[idx]}</div>
                  <div style={{ fontSize: 11, color: T.muted }}>
                    {level.mode === 'single'
                      ? `${level.provider} / ${level.model}`
                      : `Split → ${level.structuringProvider ?? 'gemini'} / ${level.structuringModel ?? level.model}`}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button type="button" disabled={fi === 0} onClick={() => moveFallback(fi, -1)}
                    style={{ background: 'none', border: 'none', cursor: fi === 0 ? 'default' : 'pointer', fontSize: 14, color: fi === 0 ? T.border : T.muted, padding: 4 }}>
                    &#9650;
                  </button>
                  <button type="button" disabled={fi === fallbacks.length - 1} onClick={() => moveFallback(fi, 1)}
                    style={{ background: 'none', border: 'none', cursor: fi === fallbacks.length - 1 ? 'default' : 'pointer', fontSize: 14, color: fi === fallbacks.length - 1 ? T.border : T.muted, padding: 4 }}>
                    &#9660;
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => updateFallback(fi, { ...level, enabled: !level.enabled })}
                  style={{
                    width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: level.enabled ? T.green : T.border, position: 'relative',
                  }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%', background: '#fff',
                    position: 'absolute', top: 3, left: level.enabled ? 23 : 3,
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }} />
                </button>
              </div>

              <ModelPicker
                level={{ ...level, label: LEVEL_LABELS[idx] }}
                accent={color}
                onChange={(l) => updateFallback(fi, l)}
              />

              <div style={{ marginTop: 12, textAlign: 'right' }}>
                <button type="button" onClick={() => removeFallback(fi)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: T.red, fontFamily: T.font }}>
                  Remove fallback
                </button>
              </div>
            </div>
          );
        })}

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
          {chain.length < 3 && (
            <button type="button" onClick={addFallback}
              style={{ ...btnS, padding: '8px 16px', fontSize: 12, borderStyle: 'dashed', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 18, lineHeight: 1 }}>+</span> Add fallback model
            </button>
          )}
        </div>
      </Section>

      {/* Save bar */}
      <div style={{
        display: 'flex', gap: 12, alignItems: 'center', marginBottom: 28,
        padding: '14px 18px', borderRadius: 10, background: dirty ? T.warnSoft : T.panel,
        border: `1px solid ${dirty ? T.amber : T.border}`,
      }}>
        <button
          style={{ ...btnP, opacity: saving || !dirty ? 0.5 : 1 }}
          disabled={saving || !dirty}
          onClick={() => void handleSave()}
        >
          {saving ? 'Saving...' : 'Save Pipeline'}
        </button>
        {dirty
          ? <span style={{ fontSize: 12, color: T.amber, fontWeight: 600 }}>Unsaved changes — Primary and fallbacks save together</span>
          : <span style={{ fontSize: 12, color: T.muted }}>All changes saved</span>}
      </div>

      {/* ═══ API Keys ═══ */}
      <Section title="API Keys" subtitle={`${ALL_PROVIDERS.filter((p) => p.id === 'gemini' || creds[`${p.id}.apiKey`]).length}/${ALL_PROVIDERS.length} configured`} defaultOpen={true}>
        <p style={{ fontSize: 12, color: T.muted, margin: '0 0 12px', lineHeight: 1.5 }}>
          Each provider needs an API key (except Gemini which uses ADC).
        </p>
        {ALL_PROVIDERS.map((prov) => {
          const keyField = `${prov.id}.apiKey`;
          const shown = !!revealed[keyField];
          const hasKey = !!(creds[keyField]);
          const isActive = chain.some((l) => l.enabled && (
            l.provider === prov.id || l.structuringProvider === prov.id ||
            (l.mode === 'split' && prov.id === 'mistral')
          ));
          const isGeminiAdc = prov.id === 'gemini';
          return (
            <div key={prov.id} style={{
              ...card, padding: '14px 18px',
              opacity: isActive ? 1 : 0.45,
              borderColor: isActive && !isGeminiAdc && !hasKey ? T.amber : T.border,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={dot(isGeminiAdc || hasKey)} />
                <span style={{ fontSize: 14, fontWeight: 700 }}>{prov.label}</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
                  background: isGeminiAdc || hasKey ? T.successSoft : T.border,
                  color: isGeminiAdc || hasKey ? T.green : T.muted,
                }}>{isGeminiAdc ? 'ADC' : hasKey ? 'Configured' : 'No key'}</span>
                {isActive && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
                    background: T.accent, color: '#fff', marginLeft: 'auto',
                  }}>IN USE</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 4, marginBottom: isGeminiAdc ? 0 : 10 }}>{prov.desc}</div>
              {!isGeminiAdc && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type={shown ? 'text' : 'password'} style={{ ...inp, flex: 1 }}
                    placeholder={`${prov.label} API key`} autoComplete="off"
                    value={creds[keyField] ?? ''}
                    onChange={(e) => setCreds((p) => ({ ...p, [keyField]: e.target.value }))} />
                  <button type="button" style={{ ...btnS, padding: '8px 12px', fontSize: 11 }} onClick={() => toggle(keyField)}>
                    {shown ? 'Hide' : 'Show'}
                  </button>
                  <button style={{ ...btnP, padding: '8px 14px', fontSize: 11 }} onClick={() => void handleSaveCreds(prov.id)}>Save</button>
                  {hasKey && (
                    <button style={{ ...btnS, padding: '8px 12px', fontSize: 11, color: T.red, borderColor: T.red }}
                      onClick={() => void handleClearCreds(prov.id)}>Clear</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Section>

      {/* ═══ Pricing (collapsed) ═══ */}
      <Section title="Model Pricing" subtitle="$/1M tokens" defaultOpen={false}>
        <p style={{ fontSize: 12, color: T.muted, margin: '0 0 12px' }}>
          Per-model token pricing for cost calculation. Edit to override defaults.
        </p>
        <div style={card}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' }}>
            {providerGroups.map((g) => (
              <button key={g.id} type="button"
                style={{
                  padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 12,
                  border: `1px solid ${pricingFilter === g.id ? T.accent : T.border}`,
                  background: pricingFilter === g.id ? T.accent : 'transparent',
                  color: pricingFilter === g.id ? '#fff' : T.text,
                  cursor: 'pointer', fontFamily: T.font,
                }}
                onClick={() => setPricingFilter(g.id)}>{g.label}</button>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: T.font }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${T.border}` }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 700, color: T.muted, fontSize: 10, textTransform: 'uppercase' }}>Model</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', fontWeight: 700, color: T.muted, fontSize: 10, textTransform: 'uppercase', width: 120 }}>Input $/1M</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', fontWeight: 700, color: T.muted, fontSize: 10, textTransform: 'uppercase', width: 120 }}>Output $/1M</th>
                  <th style={{ width: 50 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredModels.map((model) => {
                  const price = modelPricing[model];
                  const def = defaultPricing[model];
                  const isModified = def && (price?.inputPer1M !== def.inputPer1M || price?.outputPer1M !== def.outputPer1M);
                  if (!price) return null;
                  return (
                    <tr key={model} style={{ borderBottom: `1px solid ${T.border}` }}>
                      <td style={{ padding: '5px 6px', fontWeight: 600, fontSize: 12 }}>
                        {model}
                        {isModified && <span style={{ marginLeft: 6, fontSize: 9, color: T.amber, fontWeight: 700 }}>CUSTOM</span>}
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                        <input type="number" step="0.01" min="0"
                          style={{ ...inp, width: 90, textAlign: 'right', padding: '4px 6px', fontSize: 12 }}
                          value={price.inputPer1M} onChange={(e) => handlePricingChange(model, 'inputPer1M', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                        <input type="number" step="0.01" min="0"
                          style={{ ...inp, width: 90, textAlign: 'right', padding: '4px 6px', fontSize: 12 }}
                          value={price.outputPer1M} onChange={(e) => handlePricingChange(model, 'outputPer1M', e.target.value)} />
                      </td>
                      <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                        {isModified && (
                          <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: T.muted, textDecoration: 'underline' }}
                            onClick={() => handleResetPricing(model)}>Reset</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 14 }}>
            <button style={btnP} disabled={savingPricing} onClick={() => void handleSavePricing()}>
              {savingPricing ? 'Saving...' : 'Save Pricing'}
            </button>
          </div>
        </div>
      </Section>

      <Section title="How it Works" defaultOpen={false}>
        <div style={{ ...card, background: '#f8f9fb', fontSize: 13, color: T.muted, lineHeight: 1.8 }}>
          <strong style={{ color: T.text }}>Primary</strong> — always runs first. Change it anytime without touching fallbacks.<br />
          <strong style={{ color: T.text }}>Fallback</strong> — optional Secondary / Tertiary. Used only if Primary fails or totals don't match.<br /><br />
          Match → <span style={{ color: T.green, fontWeight: 600 }}>OCR_COMPLETED</span>. All fail reconcile → best attempt as <span style={{ color: T.amber, fontWeight: 600 }}>NEED_REVIEW</span>. All crash → <span style={{ color: T.red, fontWeight: 600 }}>FAILED</span>.
        </div>
      </Section>

      <Toast message={toast} />
    </div>
  );
}
