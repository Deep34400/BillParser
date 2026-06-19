import { useState, useEffect, useCallback } from 'react';
import { api } from '../api.js';
import { T } from '../theme.js';
import { Toast } from '../components/Toast.js';
import type { SettingsData } from '../types.js';

const STRUCTURING_PROVIDERS = [
  { name: 'anthropic', label: 'Anthropic' },
  { name: 'openai', label: 'OpenAI' },
  { name: 'mistral', label: 'Mistral' },
];

const STRUCTURING_CRED_LABELS: Record<string, string> = {
  anthropic: 'Anthropic API key',
  openai: 'OpenAI API key',
  mistral: 'Mistral API key',
};

// Fields that hold secrets are masked by default and get a show/hide toggle.
// Everything else (endpoint, region, ids, location) is a plain visible text field.
const SECRET_FIELDS = new Set(['apiKey', 'secretAccessKey', 'keyJson']);

const cardStyle: React.CSSProperties = {
  background: T.panel,
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  padding: '20px 24px',
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: T.muted,
  marginBottom: 4,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  fontSize: 13,
  fontFamily: T.font,
  color: T.text,
  background: T.bg,
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
};

const btnPrimary: React.CSSProperties = {
  background: T.accent,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '7px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: T.font,
};

const btnSecondary: React.CSSProperties = {
  background: 'transparent',
  color: T.muted,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  padding: '7px 16px',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: T.font,
};

const toggleBtn: React.CSSProperties = {
  flex: 'none',
  background: 'transparent',
  color: T.accent,
  border: `1px solid ${T.border}`,
  borderRadius: 6,
  padding: '0 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: T.font,
};

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: T.faint,
  margin: '0 0 4px',
  fontFamily: T.mono,
};

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [extractionProvider, setExtractionProvider] = useState('');
  const [structuringProvider, setStructuringProvider] = useState('');
  const [structuringModel, setStructuringModel] = useState('');
  // keyed by `${providerName}.${field}`
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  // structuring provider api keys keyed by provider name
  const [structCredValues, setStructCredValues] = useState<Record<string, string>>({});
  // which secret inputs are currently revealed, keyed the same as the value maps
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const toggleReveal = (key: string) =>
    setRevealed((prev) => ({ ...prev, [key]: !prev[key] }));

  // Refresh provider status/selections only. Deliberately does NOT touch the
  // typed-in credential values, so entered values stay in their fields after a save.
  const load = useCallback(async () => {
    const data = await api.settings();
    setSettings(data);
    setExtractionProvider(data.extractionProvider);
    setStructuringProvider(data.structuringProvider);
    setStructuringModel(data.structuringModel);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveSelections = async () => {
    try {
      await api.saveSettings({ extractionProvider, structuringProvider, structuringModel });
      await load();
      showToast('Selections saved');
    } catch (e) {
      showToast(`Could not save: ${(e as Error).message}`);
    }
  };

  const handleSaveCreds = async (providerName: string, displayName: string) => {
    const body: Record<string, string> = {};
    const provider = settings?.providers.find((p) => p.name === providerName);
    provider?.requiredCredentials?.forEach((field) => {
      const val = credValues[`${providerName}.${field}`];
      // only send fields the user actually typed; blanks are left untouched (merge on the server)
      if (val !== undefined && val !== '') body[field] = val;
    });
    if (Object.keys(body).length === 0) {
      showToast('Enter a value first');
      return;
    }
    try {
      await api.saveCreds(providerName, body);
      await load();
      showToast(`${displayName} credentials saved`);
    } catch (e) {
      showToast(`Could not save: ${(e as Error).message}`);
    }
  };

  const handleClearCreds = async (providerName: string, displayName: string) => {
    try {
      await api.clearCreds(providerName);
      setCredValues((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) if (k.startsWith(`${providerName}.`)) delete next[k];
        return next;
      });
      await load();
      showToast(`${displayName} credentials cleared`);
    } catch (e) {
      showToast(`Could not clear: ${(e as Error).message}`);
    }
  };

  const handleSaveStructCreds = async (providerName: string, label: string) => {
    const val = structCredValues[providerName] ?? '';
    if (val === '') {
      showToast('Enter a value first');
      return;
    }
    try {
      await api.saveCreds(providerName, { apiKey: val });
      await load();
      showToast(`${label} key saved`);
    } catch (e) {
      showToast(`Could not save: ${(e as Error).message}`);
    }
  };

  const handleClearStructCreds = async (providerName: string, label: string) => {
    try {
      await api.clearCreds(providerName);
      setStructCredValues((prev) => {
        const next = { ...prev };
        delete next[providerName];
        return next;
      });
      await load();
      showToast(`${label} key cleared`);
    } catch (e) {
      showToast(`Could not clear: ${(e as Error).message}`);
    }
  };

  if (!settings) {
    return (
      <div style={{ padding: '24px 30px', fontFamily: T.font, color: T.muted }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ padding: '24px 30px', fontFamily: T.font, color: T.text, maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 4px' }}>Settings</h1>
      <p style={{ fontSize: 13, color: T.muted, margin: '0 0 28px' }}>
        Provider integrations &amp; extraction engine
      </p>

      {/* Section 1 — Selections */}
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 10px', color: T.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Selections
      </h2>
      <div style={cardStyle}>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Active extraction provider</label>
          <select
            style={selectStyle}
            value={extractionProvider}
            onChange={(e) => setExtractionProvider(e.target.value)}
          >
            {settings.providers.map((p) => (
              // Use "displayName (name)" format so bare displayName doesn't appear as option text
              <option key={p.name} value={p.name}>
                {p.displayName} ({p.name})
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Structuring model provider</label>
          <select
            style={selectStyle}
            value={structuringProvider}
            onChange={(e) => setStructuringProvider(e.target.value)}
          >
            {STRUCTURING_PROVIDERS.map((p) => (
              <option key={p.name} value={p.name}>{p.label}</option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Structuring model</label>
          <input
            type="text"
            style={inputStyle}
            value={structuringModel}
            onChange={(e) => setStructuringModel(e.target.value)}
            placeholder="e.g. claude-sonnet-4-6"
          />
        </div>
        <button style={btnPrimary} onClick={handleSaveSelections}>
          Save selections
        </button>
      </div>

      {/* Section 2 — Provider credentials (rendered BEFORE section 3) */}
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: '24px 0 10px', color: T.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Provider credentials
      </h2>
      {settings.providers.map((provider) => (
        <div key={provider.name} style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>{provider.displayName}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 20,
                background: provider.configured ? '#d4f7e7' : T.border,
                color: provider.configured ? T.green : T.muted,
              }}
            >
              {provider.configured ? 'Configured' : 'Not configured'}
            </span>
            <span style={{ fontSize: 11, color: T.faint, marginLeft: 'auto' }}>{provider.kind}</span>
          </div>

          {provider.requiredCredentials?.map((field) => {
            const key = `${provider.name}.${field}`;
            const isSecret = SECRET_FIELDS.has(field);
            const shown = !isSecret || !!revealed[key];
            const maskedHint = provider.masked?.[field];
            return (
              <div key={field} style={{ marginBottom: 12 }}>
                <label style={labelStyle}>{field}</label>
                {maskedHint && <p style={hintStyle}>Saved: {maskedHint}</p>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type={shown ? 'text' : 'password'}
                    style={inputStyle}
                    placeholder={field}
                    autoComplete="off"
                    value={credValues[key] ?? ''}
                    onChange={(e) =>
                      setCredValues((prev) => ({ ...prev, [key]: e.target.value }))
                    }
                  />
                  {isSecret && (
                    <button type="button" style={toggleBtn} onClick={() => toggleReveal(key)}>
                      {shown ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button style={btnPrimary} onClick={() => handleSaveCreds(provider.name, provider.displayName)}>
              Save
            </button>
            <button style={btnSecondary} onClick={() => handleClearCreds(provider.name, provider.displayName)}>
              Clear
            </button>
          </div>
        </div>
      ))}

      {/* Section 3 — Structuring provider credentials (rendered AFTER section 2) */}
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: '24px 0 10px', color: T.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Structuring provider credentials
      </h2>
      {STRUCTURING_PROVIDERS.map((sp) => {
        const key = `struct.${sp.name}`;
        const shown = !!revealed[key];
        return (
          <div key={sp.name} style={cardStyle}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>{sp.label}</div>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>API Key</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type={shown ? 'text' : 'password'}
                  style={inputStyle}
                  placeholder={STRUCTURING_CRED_LABELS[sp.name]}
                  autoComplete="off"
                  value={structCredValues[sp.name] ?? ''}
                  onChange={(e) =>
                    setStructCredValues((prev) => ({ ...prev, [sp.name]: e.target.value }))
                  }
                />
                <button type="button" style={toggleBtn} onClick={() => toggleReveal(key)}>
                  {shown ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btnPrimary} onClick={() => handleSaveStructCreds(sp.name, sp.label)}>
                Save
              </button>
              <button style={btnSecondary} onClick={() => handleClearStructCreds(sp.name, sp.label)}>
                Clear
              </button>
            </div>
          </div>
        );
      })}

      <Toast message={toast} />
    </div>
  );
}
