import { useMemo, useState } from 'react';
import { T } from '../theme.js';

export interface TableColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  width?: string;
  render: (row: T) => React.ReactNode;
  searchValue?: (row: T) => string;
}

interface SearchableTableProps<T> {
  rows: T[];
  columns: TableColumn<T>[];
  rowKey: (row: T) => string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  maxHeight?: number;
  pageSize?: number;
}

export function SearchableTable<T>({
  rows,
  columns,
  rowKey,
  searchPlaceholder = 'Search…',
  emptyMessage = 'No data',
  maxHeight = 360,
  pageSize = 25,
}: SearchableTableProps<T>) {
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(pageSize);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      columns.some((col) => (col.searchValue?.(row) ?? '').toLowerCase().includes(q)),
    );
  }, [rows, columns, query]);

  const shown = filtered.slice(0, visible);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setVisible(pageSize); }}
          placeholder={searchPlaceholder}
          style={{
            flex: 1, padding: '8px 12px', fontSize: 13, fontFamily: T.font,
            border: `1px solid ${T.border}`, borderRadius: 8, background: T.panel,
            outline: 'none',
          }}
        />
        <span style={{ fontSize: 11, color: T.muted, whiteSpace: 'nowrap' }}>
          {countLabel(filtered.length, rows.length)}
        </span>
      </div>

      <div style={{
        border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden',
        maxHeight, overflowY: 'auto',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: T.rail, position: 'sticky', top: 0, zIndex: 1 }}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    textAlign: col.align ?? 'left',
                    padding: '10px 12px',
                    fontSize: 10, fontWeight: 700, color: T.muted,
                    letterSpacing: '0.06em', textTransform: 'uppercase',
                    width: col.width,
                    borderBottom: `1px solid ${T.border}`,
                  }}
                >
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={columns.length} style={{ padding: 24, textAlign: 'center', color: T.muted }}>
                  {emptyMessage}
                </td>
              </tr>
            ) : shown.map((row) => (
              <tr
                key={rowKey(row)}
                style={{ borderBottom: `1px solid ${T.border}` }}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{
                      padding: '10px 12px',
                      textAlign: col.align ?? 'left',
                      color: T.text,
                      verticalAlign: 'middle',
                    }}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visible < filtered.length && (
        <button
          type="button"
          onClick={() => setVisible((v) => v + pageSize)}
          style={{
            marginTop: 10, width: '100%', padding: '8px 12px',
            background: T.panel, border: `1px solid ${T.border}`, borderRadius: 8,
            fontSize: 13, color: T.accent, cursor: 'pointer', fontFamily: T.font,
          }}
        >
          Show more ({filtered.length - visible} remaining)
        </button>
      )}
    </div>
  );
}

function countLabel(shown: number, total: number): string {
  if (shown === total) return `${total.toLocaleString('en-IN')} total`;
  return `${shown.toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}`;
}
