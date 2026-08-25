import { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api/client.js';
import { T } from '../theme.js';
import { Toast } from '../components/Toast.js';
import type { ModelPrice } from '../types/index.js';

const card: React.CSSProperties = {
  background: T.panel, border: `1px solid ${T.border}`,
  borderRadius: 10, padding: '20px 24px', marginBottom: 16,
};
const lbl: React.CSSProperties = {
  display: 'block', fontSize: 12, fontWeight: 600, color: T.muted,
  marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
};
const inp: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: `1px solid ${T.border}`,
  borderRadius: 6, fontSize: 13, fontFamily: T.font, color: T.text,
  background: T.bg, boxSizing: 'border-box',
};
const sel: React.CSSProperties = { ...inp, cursor: 'pointer' };
const btnP: React.CSSProperties = {
  background: T.accent, color: '#fff', border: 'none', borderRadius: 6,
  padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
};
const btnS: React.CSSProperties = {
  background: 'transparent', color: T.muted, border: `1px solid ${T.border}`,
  borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', fontFamily: T.font,
};
const toggleWrap: React.CSSProperties = {
  display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden',
  border: `1px solid ${T.border}`, marginBottom: 12,
};
function togBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1, padding: '12px 16px', fontSize: 13, fontWeight: 600,
    border: 'none', cursor: 'pointer', fontFamily: T.font,
    background: active ? T.accent : T.bg, color: active ? '#fff' : T.text,
    transition: 'background 0.15s',
  };
}
const note: React.CSSProperties = { fontSize: 11, color: T.muted, marginTop: 6 };
const badge = (ok: boolean): React.CSSProperties => ({
  display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 10px',
  borderRadius: 12, background: ok ? '#d4f7e7' : '#fff3cd',
  color: ok ? T.green : '#856404', letterSpacing: '0.03em',
});
const dot = (ok: boolean): React.CSSProperties => ({
  width: 8, height: 8, borderRadius: '50%', background: ok ? T.green : T.border,
  display: 'inline-block', marginRight: 6,
});

interface ProvDef {
  id: string;
  label: string;
  models: string[];
  canStructure: boolean;
  canSingle: boolean;
  desc: string;
}

const ALL_PROVIDERS: ProvDef[] = [
  { id: 'mistral', label: 'Mistral', models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'pixtral-12b-2409'], canStructure: true, canSingle: true, desc: 'Mistral — Single: PDF uses OCR+structure (stays Single mode); images use Pixtral' },
  { id: 'gemini', label: 'Google Gemini', models: ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'], canStructure: true, canSingle: true, desc: 'Gemini — always Vertex AI + ADC (no API key). Pick any model; default Single mode.' },
  { id: 'claude', label: 'Anthropic Claude', models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'], canStructure: true, canSingle: true, desc: 'Claude — structuring or single PDF/image call' },
  { id: 'openai', label: 'OpenAI GPT', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'], canStructure: true, canSingle: true, desc: 'OpenAI — structuring or single image call (PDF: use Split/Gemini/Claude)' },
];

export function SettingsPage() {
  const [mode, setMode] = useState<'split' | 'single'>('single');
  const [savedMode, setSavedMode] = useState<'split' | 'single'>('single');
  const [savedStructProv, setSavedStructProv] = useState('gemini');
  const [savedStructModel, setSavedStructModel] = useState('gemini-2.5-flash');
  const [savedSingleProv, setSavedSingleProv] = useState('gemini');
  const [savedSingleModel, setSavedSingleModel] = useState('gemini-2.5-flash');
  const [structProv, setStructProv] = useState('gemini');
  const [structModel, setStructModel] = useState('gemini-2.5-flash');
  const [singleProv, setSingleProv] = useState('gemini');
  const [singleModel, setSingleModel] = useState('gemini-2.5-flash');
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
      const pm = s.pipelineMode === 'split' ? 'split' : 'single';
      const sp = s.structuringProvider || 'gemini';
      const sm = s.structuringModel || 'gemini-2.5-flash';
      const snp = s.singleProvider || 'gemini';
      const snm = s.singleModel || 'gemini-2.5-flash';
      setMode(pm);
      setSavedMode(pm);
      setStructProv(sp); setStructModel(sm);
      setSingleProv(snp); setSingleModel(snm);
      setSavedStructProv(sp); setSavedStructModel(sm);
      setSavedSingleProv(snp); setSavedSingleModel(snm);
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

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveSettings({
        pipelineMode: mode,
        extractionProvider: 'mistral',
        structuringProvider: structProv,
        structuringModel: structModel,
        singleProvider: singleProv,
        singleModel: singleModel,
      });
      setSavedMode(mode);
      setSavedStructProv(structProv); setSavedStructModel(structModel);
      setSavedSingleProv(singleProv); setSavedSingleModel(singleModel);
      flash(`Saved — ${mode === 'split' ? `Split: Mistral OCR → ${structProv} (${structModel})` : `Single: ${singleProv} (${singleModel})`}`);
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
    finally { setSaving(false); }
  };

  const handleSaveCreds = async (provId: string) => {
    const val = creds[`${provId}.apiKey`];
    if (!val) { flash('Enter an API key first'); return; }
    try {
      await api.saveCreds(provId, { apiKey: val });
      await load();
      flash(`${provId} key saved`);
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
  };

  const handleClearCreds = async (provId: string) => {
    try {
      await api.clearCreds(provId);
      setCreds((p) => { const n = { ...p }; delete n[`${provId}.apiKey`]; return n; });
      await load();
      flash(`${provId} key cleared`);
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
  };

  const currentStructDef = ALL_PROVIDERS.find((p) => p.id === structProv) ?? ALL_PROVIDERS[0];
  const currentSingleDef = ALL_PROVIDERS.find((p) => p.id === singleProv) ?? ALL_PROVIDERS[1];
  const dirty = mode !== savedMode || structProv !== savedStructProv || structModel !== savedStructModel || singleProv !== savedSingleProv || singleModel !== savedSingleModel;

  const handlePricingChange = (model: string, field: 'inputPer1M' | 'outputPer1M', val: string) => {
    const n = parseFloat(val);
    if (Number.isNaN(n) && val !== '') return;
    setModelPricing((prev) => ({
      ...prev,
      [model]: { ...prev[model], [field]: val === '' ? 0 : n },
    }));
  };

  const handleSavePricing = async () => {
    setSavingPricing(true);
    try {
      const overrides: Record<string, ModelPrice> = {};
      for (const [model, price] of Object.entries(modelPricing)) {
        const def = defaultPricing[model];
        if (!def || price.inputPer1M !== def.inputPer1M || price.outputPer1M !== def.outputPer1M) {
          overrides[model] = price;
        }
      }
      await api.saveSettings({ modelPricing: overrides });
      flash('Model pricing saved');
    } catch (e) { flash(`Error: ${(e as Error).message}`); }
    finally { setSavingPricing(false); }
  };

  const handleResetPricing = (model: string) => {
    const def = defaultPricing[model];
    if (def) {
      setModelPricing((prev) => ({ ...prev, [model]: { ...def } }));
    }
  };

  const providerGroups = useMemo(() => {
    const groups: { label: string; id: string; models: string[] }[] = [
      { label: 'All Models', id: 'all', models: Object.keys(modelPricing) },
      ...ALL_PROVIDERS.map((p) => ({
        label: p.label,
        id: p.id,
        models: p.models.concat(p.id === 'mistral' ? ['mistral-ocr-latest'] : []),
      })),
    ];
    return groups;
  }, [modelPricing]);

  const filteredModels = useMemo(() => {
    if (pricingFilter === 'all') return Object.keys(modelPricing).sort();
    const group = providerGroups.find((g) => g.id === pricingFilter);
    if (!group) return Object.keys(modelPricing).sort();
    return group.models.filter((m) => m in modelPricing).sort();
  }, [pricingFilter, modelPricing, providerGroups]);

  if (!loaded) return <div style={{ padding: 24, fontFamily: T.font, color: T.muted }}>Loading...</div>;

  return (
    <div style={{ padding: '24px 30px', fontFamily: T.font, color: T.text, maxWidth: 740 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>OCR Pipeline Settings</h1>
      <p style={{ fontSize: 13, color: T.muted, margin: '0 0 24px' }}>
        Default: <strong>Single + Gemini</strong> via ADC (Vertex). Change mode/model below and Save — OCR uses Settings, not env keys for Gemini.
      </p>

      {/* Active mode banner */}
      <div style={{
        ...card,
        display: 'flex', alignItems: 'center', gap: 14,
        background: savedMode === 'single' ? '#eef6ff' : '#f0faf4',
        borderColor: savedMode === 'single' ? '#b3d4fc' : '#b7e4c7',
        marginBottom: 16,
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
            Currently active (stored)
          </div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {savedMode === 'split' ? 'Split — Extract + Structure' : 'Single — One API Call'}
          </div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
            {savedMode === 'split'
              ? `Mistral OCR → ${savedStructProv} (${savedStructModel})`
              : `${savedSingleProv} (${savedSingleModel}) does OCR + structure together`}
          </div>
        </div>
        <span style={badge(true)}>{savedMode.toUpperCase()}</span>
      </div>

      {/* ─── Pipeline mode picker ─── */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={lbl}>Select Pipeline Mode</div>
          {dirty && <span style={badge(false)}>Unsaved change</span>}
        </div>

        <div style={toggleWrap}>
          <button type="button" style={togBtn(mode === 'split')} onClick={() => setMode('split')}>
            Split (2 API calls)
          </button>
          <button type="button" style={togBtn(mode === 'single')} onClick={() => setMode('single')}>
            Single (1 API call)
          </button>
        </div>

        <div style={{ fontSize: 12, color: T.muted, marginBottom: 16, lineHeight: 1.5 }}>
          {mode === 'split'
            ? 'Split: Step 1 Mistral OCR (PDF → markdown), Step 2 any LLM converts markdown → JSON.'
            : 'Single: One multimodal call — pick Gemini, Claude, OpenAI, or Mistral Pixtral. PDF best with Gemini/Claude.'}
        </div>

        {mode === 'split' ? (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={lbl}>Step 1 — Extraction (OCR)</div>
              <select style={sel} disabled value="mistral">
                <option value="mistral">Mistral OCR (mistral-ocr-latest)</option>
              </select>
              <div style={note}>Always uses Mistral dedicated OCR for best PDF/image reading.</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={lbl}>Step 2 — Structuring Provider</div>
              <select style={sel} value={structProv} onChange={(e) => {
                const id = e.target.value;
                setStructProv(id);
                const def = ALL_PROVIDERS.find((p) => p.id === id);
                if (def?.models[0]) setStructModel(def.models[0]);
              }}>
                {ALL_PROVIDERS.filter((p) => p.canStructure).map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <div style={note}>{currentStructDef.desc}. Falls back to Mistral if this fails.</div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <div style={lbl}>Structuring Model</div>
              <select style={sel} value={structModel} onChange={(e) => setStructModel(e.target.value)}>
                {currentStructDef.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={lbl}>Provider (OCR + Structuring in one call)</div>
              <select style={sel} value={singleProv} onChange={(e) => {
                const id = e.target.value;
                setSingleProv(id);
                const def = ALL_PROVIDERS.find((p) => p.id === id);
                if (id === 'mistral') setSingleModel('pixtral-12b-2409');
                else if (def?.models[0]) setSingleModel(def.models[0]);
              }}>
                {ALL_PROVIDERS.filter((p) => p.canSingle).map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <div style={note}>
                Document sent as Single mode. Gemini/Claude: true one-call PDF/image.
                Mistral PDF: OCR + structure (still Single setting, not Split). OpenAI: images only.
                Falls back to Split only if the provider API fails.
              </div>
            </div>
            <div style={{ marginBottom: 18 }}>
              <div style={lbl}>Model</div>
              <select style={sel} value={singleModel} onChange={(e) => setSingleModel(e.target.value)}>
                {currentSingleDef.models.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </>
        )}

        <button style={btnP} disabled={saving} onClick={() => void handleSave()}>
          {saving ? 'Saving...' : `Save as ${mode.toUpperCase()} mode`}
        </button>
      </div>

      {/* ─── Model Pricing ─── */}
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: '24px 0 10px', color: T.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Model Pricing ($/1M tokens)
      </h2>
      <p style={{ fontSize: 12, color: T.muted, margin: '0 0 12px', lineHeight: 1.5 }}>
        Per-model token pricing used for cost calculation. Defaults from Google/Anthropic/OpenAI/Mistral official pricing.
        Edit any value to override — your changes are saved and used for future cost estimates.
      </p>

      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={lbl}>Filter by provider</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {providerGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                style={{
                  padding: '4px 12px', fontSize: 11, fontWeight: 600, borderRadius: 12,
                  border: `1px solid ${pricingFilter === g.id ? T.accent : T.border}`,
                  background: pricingFilter === g.id ? T.accent : 'transparent',
                  color: pricingFilter === g.id ? '#fff' : T.text,
                  cursor: 'pointer', fontFamily: T.font,
                }}
                onClick={() => setPricingFilter(g.id)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: T.font }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${T.border}` }}>
                <th style={{ textAlign: 'left', padding: '8px 6px', fontWeight: 700, color: T.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Model</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', fontWeight: 700, color: T.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', width: 130 }}>Input $/1M</th>
                <th style={{ textAlign: 'right', padding: '8px 6px', fontWeight: 700, color: T.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', width: 130 }}>Output $/1M</th>
                <th style={{ textAlign: 'center', padding: '8px 6px', width: 60 }}></th>
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
                    <td style={{ padding: '6px 6px', fontWeight: 600, color: T.text, fontSize: 12 }}>
                      {model}
                      {isModified && <span style={{ marginLeft: 6, fontSize: 9, color: '#e67e22', fontWeight: 700 }}>CUSTOM</span>}
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        style={{ ...inp, width: 100, textAlign: 'right', padding: '4px 6px', fontSize: 12 }}
                        value={price.inputPer1M}
                        onChange={(e) => handlePricingChange(model, 'inputPer1M', e.target.value)}
                      />
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        style={{ ...inp, width: 100, textAlign: 'right', padding: '4px 6px', fontSize: 12 }}
                        value={price.outputPer1M}
                        onChange={(e) => handlePricingChange(model, 'outputPer1M', e.target.value)}
                      />
                    </td>
                    <td style={{ padding: '4px 6px', textAlign: 'center' }}>
                      {isModified && (
                        <button
                          type="button"
                          style={{ ...btnS, padding: '2px 8px', fontSize: 10 }}
                          onClick={() => handleResetPricing(model)}
                          title="Reset to default"
                        >
                          Reset
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
          <button style={btnP} disabled={savingPricing} onClick={() => void handleSavePricing()}>
            {savingPricing ? 'Saving...' : 'Save Pricing'}
          </button>
          <span style={{ fontSize: 11, color: T.muted }}>
            Prices are in USD per 1 million tokens. Changes apply to future cost calculations.
          </span>
        </div>
      </div>

      {/* ─── API Keys ─── */}
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: '24px 0 10px', color: T.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        API Keys
      </h2>
      <p style={{ fontSize: 12, color: T.muted, margin: '0 0 12px' }}>
        Save your API key for each provider you use. Env vars are used as fallback.
        Gemini on Cloud Run: leave key empty — service account (ADC) uses Vertex AI.
      </p>

      {ALL_PROVIDERS.map((prov) => {
        const keyField = `${prov.id}.apiKey`;
        const shown = !!revealed[keyField];
        const hasKey = !!(creds[keyField]);
        const isActive = mode === 'split'
          ? (prov.id === 'mistral' || prov.id === structProv)
          : (prov.id === singleProv);
        const isGeminiAdc = prov.id === 'gemini';

        return (
          <div key={prov.id} style={{ ...card, opacity: isActive ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={dot(isGeminiAdc || hasKey)} />
              <span style={{ fontSize: 15, fontWeight: 700 }}>{prov.label}</span>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
                background: isGeminiAdc || hasKey ? '#d4f7e7' : T.border,
                color: isGeminiAdc || hasKey ? T.green : T.muted,
                marginLeft: 4,
              }}>{isGeminiAdc ? 'ADC (Vertex)' : hasKey ? 'Key saved' : 'No key'}</span>
              {isActive && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
                  background: T.accent, color: '#fff', marginLeft: 'auto',
                }}>ACTIVE</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>{prov.desc}</div>
            {isGeminiAdc ? (
              <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
                No API key. Uses Application Default Credentials → Vertex AI.
                Pick any Gemini model above; it always authenticates with ADC.
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 10 }}>
                  <div style={lbl}>API Key</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type={shown ? 'text' : 'password'}
                      style={inp}
                      placeholder={`Paste ${prov.label} API key`}
                      autoComplete="off"
                      value={creds[keyField] ?? ''}
                      onChange={(e) => setCreds((p) => ({ ...p, [keyField]: e.target.value }))}
                    />
                    <button type="button" style={btnS} onClick={() => toggle(keyField)}>
                      {shown ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={btnP} onClick={() => void handleSaveCreds(prov.id)}>Save</button>
                  <button style={btnS} onClick={() => void handleClearCreds(prov.id)}>Clear</button>
                </div>
              </>
            )}
          </div>
        );
      })}

      {/* ─── How it works ─── */}
      <div style={{ ...card, background: '#f8f9fb' }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10 }}>How it works</div>
        <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.7 }}>
          Setting key: <code>pipelineMode</code> = <code>"split"</code> or <code>"single"</code> (stored in DB).
          <br /><br />
          <strong>Split</strong> — 2 API calls:<br />
          1. Mistral OCR reads PDF/image → markdown<br />
          2. Selected LLM (Gemini / Mistral / Claude / GPT) → structured JSON
          <br /><br />
          <strong>Single</strong> — 1 API call (<code>singleProvider</code> + <code>singleModel</code>):<br />
          Gemini or Claude: PDF/image → JSON<br />
          OpenAI or Mistral Pixtral: image → JSON (PDF: use Split or Gemini/Claude)
          <br /><br />
          On failure, system auto-falls back to Split (Mistral OCR + Mistral structure).
        </div>
      </div>

      <Toast message={toast} />
    </div>
  );
}
