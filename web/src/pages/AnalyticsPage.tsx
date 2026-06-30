import { useEffect, useState } from 'react';
import type { Analytics } from '../types/index.js';
import { api } from '../api/client.js';
import { T } from '../theme.js';
import { money, confLabel } from '../lib/format.js';

export function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.analytics().then((d) => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '24px 30px', fontFamily: T.font, color: T.muted }}>
        Loading…
      </div>
    );
  }

  if (!data || data.completedCount === 0) {
    return (
      <div style={{ padding: '24px 30px', fontFamily: T.font }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, margin: '0 0 4px', color: T.text }}>Analytics</h1>
        <p style={{ color: T.muted, margin: '0 0 32px', fontSize: 14 }}>
          {data ? `Spend across ${data.completedCount} extracted invoices` : ''}
        </p>
        <p style={{ color: T.muted, fontSize: 14 }}>
          No completed invoices yet — upload and extract some bills to see analytics.
        </p>
      </div>
    );
  }

  const maxVendor = data.byVendor.length > 0 ? Math.max(...data.byVendor.map((v) => v.amount)) : 1;
  const maxMonth = data.byMonth.length > 0 ? Math.max(...data.byMonth.map((m) => m.amount)) : 1;

  const kpis = [
    { label: 'TOTAL SPEND', value: money(data.totalSpend), color: T.accent },
    { label: 'COMPLETED', value: String(data.completedCount), color: T.text },
    { label: 'AVG CONFIDENCE', value: confLabel(data.avgConfidence), color: T.text },
    { label: 'NEEDS REVIEW', value: String(data.needsReview), color: T.amber },
  ];

  return (
    <div style={{ padding: '24px 30px', fontFamily: T.font, color: T.text }}>
      {/* Header */}
      <h1 style={{ fontSize: 21, fontWeight: 700, margin: '0 0 4px' }}>Analytics</h1>
      <p style={{ color: T.muted, margin: '0 0 28px', fontSize: 14 }}>
        Spend across {data.completedCount} extracted invoices
      </p>

      {/* KPI cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 16,
          marginBottom: 28,
        }}
      >
        {kpis.map((k) => (
          <div
            key={k.label}
            style={{
              background: T.panel,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              padding: '18px 20px',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, letterSpacing: '0.06em', marginBottom: 8 }}>
              {k.label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: k.color }}>
              {k.value}
            </div>
          </div>
        ))}
      </div>

      {/* Two panels */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
        {/* Top vendors */}
        <div
          style={{
            background: T.panel,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: '20px 22px',
          }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 16px', color: T.text }}>
            Top vendors by spend
          </h2>
          {data.byVendor.map((v) => (
            <div key={v.name} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13 }}>
                <span style={{ color: T.text }}>{v.name}</span>
                <span style={{ color: T.muted }}>{money(v.amount)}</span>
              </div>
              <div style={{ height: 6, background: T.border, borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${maxVendor > 0 ? (v.amount / maxVendor) * 100 : 0}%`,
                    background: T.accent,
                    borderRadius: 3,
                  }}
                />
              </div>
            </div>
          ))}
          {data.byVendor.length === 0 && (
            <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>No vendor data.</p>
          )}
        </div>

        {/* Spend by month */}
        <div
          style={{
            background: T.panel,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            padding: '20px 22px',
          }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 16px', color: T.text }}>
            Spend by month
          </h2>
          {data.byMonth.map((m) => (
            <div key={m.label} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 13 }}>
                <span style={{ color: T.text }}>{m.label}</span>
                <span style={{ color: T.muted }}>{money(m.amount)}</span>
              </div>
              <div style={{ height: 6, background: T.border, borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${maxMonth > 0 ? (m.amount / maxMonth) * 100 : 0}%`,
                    background: T.green,
                    borderRadius: 3,
                  }}
                />
              </div>
            </div>
          ))}
          {data.byMonth.length === 0 && (
            <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>No monthly data.</p>
          )}
        </div>
      </div>
    </div>
  );
}
