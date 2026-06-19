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

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsData | null>(null);
  const [extractionProvider, setExtractionProvider] = useState('');
  const [structuringProvider, setStructuringProvider] = useState('');
  const [structuringModel, setStructuringModel] = useState('');
  // keyed by `${providerName}.${field}`
  const [credValues, setCredValues] = useState<Record<string, string>>({});
  // structuring provider api keys keyed by provider name
  const [structCredValues, setStructCredValues] = useState<Record<string, string>>({});
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3000);
  };

  const load = useCallback(async () => {
    const data = await api.settings();
    setSettings(data);
    setExtractionProvider(data.extractionProvider);
    setStructuringProvider(data.structuringProvider);
    setStructuringModel(data.structuringModel);
    setCredValues({});
    setStructCredValues({});
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveSelections = async () => {
    await api.saveSettings({ extractionProvider, structuringProvider, structuringModel });
    await load();
    showToast('Selections saved');
  };

  const handleSaveCreds = async (providerName: string) => {
    const body: Record<string, string> = {};
    const provider = settings?.providers.find((p) => p.name === providerName);
    provider?.requiredCredentials?.forEach((field) => {
      const val = credValues[`${providerName}.${field}`];
      if (val !== undefined) body[field] = val;
    });
    await api.saveCreds(providerName, body);
    await load();
    showToast('Saved');
  };

  const handleClearCreds = async (providerName: string) => {
    await api.clearCreds(providerName);
    await load();
    showToast('Cleared');
  };

  const handleSaveStructCreds = async (providerName: string) => {
    const val = structCredValues[providerName] ?? '';
    await api.saveCreds(providerName, { apiKey: val });
    await load();
    showToast('Saved');
  };

  const handleClearStructCreds = async (providerName: string) => {
    await api.clearCreds(providerName);
    await load();
    showToast('Cleared');
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
            const maskedHint = provider.masked?.[field];
            return (
              <div key={field} style={{ marginBottom: 12 }}>
                <label style={labelStyle}>{field}</label>
                {maskedHint && (
                  <p style={{ fontSize: 11, color: T.faint, margin: '0 0 4px', fontFamily: T.mono }}>
                    Current: {maskedHint}
                  </p>
                )}
                <input
                  type="password"
                  style={inputStyle}
                  placeholder={field}
                  value={credValues[`${provider.name}.${field}`] ?? ''}
                  onChange={(e) =>
                    setCredValues((prev) => ({
                      ...prev,
                      [`${provider.name}.${field}`]: e.target.value,
                    }))
                  }
                />
              </div>
            );
          })}

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button style={btnPrimary} onClick={() => handleSaveCreds(provider.name)}>
              Save
            </button>
            <button style={btnSecondary} onClick={() => handleClearCreds(provider.name)}>
              Clear
            </button>
          </div>
        </div>
      ))}

      {/* Section 3 — Structuring provider credentials (rendered AFTER section 2) */}
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: '24px 0 10px', color: T.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Structuring provider credentials
      </h2>
      {STRUCTURING_PROVIDERS.map((sp) => (
        <div key={sp.name} style={cardStyle}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>{sp.label}</div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>API Key</label>
            <input
              type="password"
              style={inputStyle}
              placeholder={STRUCTURING_CRED_LABELS[sp.name]}
              value={structCredValues[sp.name] ?? ''}
              onChange={(e) =>
                setStructCredValues((prev) => ({ ...prev, [sp.name]: e.target.value }))
              }
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btnPrimary} onClick={() => handleSaveStructCreds(sp.name)}>
              Save
            </button>
            <button style={btnSecondary} onClick={() => handleClearStructCreds(sp.name)}>
              Clear
            </button>
          </div>
        </div>
      ))}

      <Toast message={toast} />
    </div>
  );
}
