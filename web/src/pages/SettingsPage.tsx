import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import { T } from '../theme.js';
import { Toast } from '../components/Toast.js';

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
  { id: 'mistral', label: 'Mistral', models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'], canStructure: true, canSingle: false, desc: 'Mistral AI — OCR extraction + structuring' },
  { id: 'gemini', label: 'Google Gemini', models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'], canStructure: true, canSingle: true, desc: 'Google Gemini — fast, supports single mode' },
  { id: 'claude', label: 'Anthropic Claude', models: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307'], canStructure: true, canSingle: false, desc: 'Anthropic Claude — high accuracy structuring' },
  { id: 'openai', label: 'OpenAI GPT', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'], canStructure: true, canSingle: false, desc: 'OpenAI GPT — reliable JSON structuring' },
];

export function SettingsPage() {
  const [mode, setMode] = useState<'split' | 'single'>('split');
  const [savedMode, setSavedMode] = useState<'split' | 'single'>('split');
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

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };
  const toggle = (k: string) => setRevealed((p) => ({ ...p, [k]: !p[k] }));

  const load = useCallback(async () => {
    try {
      const s = await api.settings();
      const pm = s.pipelineMode === 'single' ? 'single' : 'split';
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

  if (!loaded) return <div style={{ padding: 24, fontFamily: T.font, color: T.muted }}>Loading...</div>;

  return (
    <div style={{ padding: '24px 30px', fontFamily: T.font, color: T.text, maxWidth: 740 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>OCR Pipeline Settings</h1>
      <p style={{ fontSize: 13, color: T.muted, margin: '0 0 24px' }}>
        Choose Split or Single mode. Setting is stored as <code>pipelineMode</code> in DB.
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
            : 'Single: One Gemini call — PDF/image goes directly to the model and returns structured JSON.'}
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
                if (def?.models[0]) setSingleModel(def.models[0]);
              }}>
                {ALL_PROVIDERS.filter((p) => p.canSingle).map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <div style={note}>PDF/image sent directly. Falls back to Split (Mistral+Mistral) if it fails.</div>
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

        return (
          <div key={prov.id} style={{ ...card, opacity: isActive ? 1 : 0.55 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={dot(hasKey)} />
              <span style={{ fontSize: 15, fontWeight: 700 }}>{prov.label}</span>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 12,
                background: hasKey ? '#d4f7e7' : T.border,
                color: hasKey ? T.green : T.muted,
                marginLeft: 4,
              }}>{hasKey ? 'Key saved' : 'No key'}</span>
              {isActive && (
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 12,
                  background: T.accent, color: '#fff', marginLeft: 'auto',
                }}>ACTIVE</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: T.muted, marginBottom: 10 }}>{prov.desc}</div>
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
          <strong>Single</strong> — 1 API call:<br />
          PDF/image → Gemini → structured JSON directly.
          <br /><br />
          On failure, system auto-falls back to Mistral.
        </div>
      </div>

      <Toast message={toast} />
    </div>
  );
}
