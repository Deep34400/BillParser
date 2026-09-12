import { cn } from '@/lib/utils.js';
import { STATUS } from '../theme.js';

export function StatusDot({ status }: { status: string }) {
  const key = status === 'OCR_COMPLETED' ? 'COMPLETED'
    : status === 'NEED_REVIEW' ? 'NEEDS_REVIEW'
    : status;
  const info = STATUS[key] ?? { label: status, color: '#6B7280' };
  const isPulse = key === 'PENDING' || key === 'PROCESSING';

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
      <span
        className={cn('inline-block h-2 w-2 rounded-full', isPulse && 'animate-[ioc-pulse_1.5s_ease-in-out_infinite]')}
        style={{ background: info.color }}
      />
      <span style={{ color: info.color }}>{info.label}</span>
    </span>
  );
}
