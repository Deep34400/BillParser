export function Toast({ message, actionLabel, onAction }: { message: string; actionLabel?: string; onAction?: () => void }) {
  if (!message) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: 24,
      left: '50%',
      transform: 'translateX(-50%)',
      background: '#1f1b30',
      color: '#fff',
      padding: '11px 18px',
      borderRadius: 10,
      boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
      fontWeight: 600,
      fontSize: 13,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 10,
      zIndex: 9999,
      whiteSpace: 'nowrap',
    }}>
      <span>{message}</span>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          style={{
            background: 'none',
            border: 'none',
            color: '#a9a0ff',
            fontWeight: 600,
            fontSize: 13,
            cursor: 'pointer',
            padding: 0,
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
