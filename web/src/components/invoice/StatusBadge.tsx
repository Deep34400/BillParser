import { Badge } from '@/components/ui/badge.js';
import { cn } from '@/lib/utils.js';
import { STATUS } from '../../theme.js';

const STYLE: Record<string, { variant: 'success' | 'warning' | 'danger' | 'info'; pulse?: boolean }> = {
  OCR_COMPLETED: { variant: 'success' },
  VERIFIED: { variant: 'success' },
  COMPLETED: { variant: 'success' },
  PROCESSING: { variant: 'warning', pulse: true },
  PENDING: { variant: 'warning', pulse: true },
  FAILED: { variant: 'danger' },
  NEED_REVIEW: { variant: 'warning' },
  NEEDS_REVIEW: { variant: 'warning' },
  PENDING_APPROVAL: { variant: 'info' },
};

function normalizeStatus(status: string): string {
  if (status === 'OCR_COMPLETED') return 'COMPLETED';
  if (status === 'NEED_REVIEW') return 'NEEDS_REVIEW';
  return status;
}

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const key = normalizeStatus(status);
  const style = STYLE[status] ?? STYLE[key] ?? { variant: 'info' as const };
  const label = STATUS[key]?.label ?? status.replace(/_/g, ' ');

  return (
    <Badge
      variant={style.variant}
      className={cn(style.pulse && 'animate-[ioc-pulse_1.5s_ease-in-out_infinite]', className)}
    >
      {label}
    </Badge>
  );
}
