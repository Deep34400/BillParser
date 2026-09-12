import { cn } from '@/lib/utils.js';

interface Props {
  value?: number | null;
  verified?: boolean;
}

export function ConfidenceBar({ value, verified }: Props) {
  if (verified) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success">
        <span className="h-2 w-2 rounded-full bg-success" />
        Verified
      </span>
    );
  }

  if (value == null) return <span className="text-xs text-faint">—</span>;

  const pct = Math.round(value * 100);
  const color = pct >= 90 ? 'bg-success' : pct >= 70 ? 'bg-warning' : 'bg-danger';
  const textColor = pct >= 90 ? 'text-success' : pct >= 70 ? 'text-warning' : 'text-danger';

  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 rounded-full bg-muted overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn('text-xs font-medium', textColor)}>{pct}%</span>
    </div>
  );
}
