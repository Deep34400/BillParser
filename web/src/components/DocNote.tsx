import { useState } from 'react';
import { T } from '../theme.js';

export interface DocItem {
  label: string;
  formula?: string;
  description: string;
  sourceFile?: string;
  severity?: string;
}

interface DocNoteProps {
  title: string;
  subtitle?: string;
  items: DocItem[];
  defaultOpen?: boolean;
}

export function DocNote({ title, subtitle, items, defaultOpen = false }: DocNoteProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{
      background: T.accentSoft,
      border: `1px solid ${T.border}`,
      borderRadius: 10,
      marginBottom: 24,
      overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontFamily: T.font,
          textAlign: 'left',
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: T.accent }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{subtitle}</div>
          )}
        </div>
        <span style={{ fontSize: 12, color: T.muted }}>{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items.map((item) => (
            <DocItemRow key={item.label} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function DocItemRow({ item }: { item: DocItem }) {
  return (
    <div style={{
      background: T.panel,
      border: `1px solid ${T.border}`,
      borderRadius: 8,
      padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{item.label}</span>
        {item.severity && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
            background: '#fff3e0', color: '#e65100',
          }}>
            {item.severity}
          </span>
        )}
        {item.sourceFile && (
          <span style={{
            fontSize: 10, fontFamily: T.mono, color: T.muted,
            background: T.rail, padding: '2px 6px', borderRadius: 4,
          }}>
            {item.sourceFile}
          </span>
        )}
      </div>
      {item.formula && (
        <div style={{
          fontFamily: T.mono, fontSize: 12, color: T.text,
          background: T.rail, border: `1px solid ${T.border}`,
          borderRadius: 6, padding: '8px 10px', marginBottom: 8,
          lineHeight: 1.5,
        }}>
          {item.formula}
        </div>
      )}
      <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.55 }}>{item.description}</div>
    </div>
  );
}
