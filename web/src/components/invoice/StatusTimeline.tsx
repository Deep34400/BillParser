import type { Invoice } from '../../types/index.js';
import { cn } from '@/lib/utils.js';

const STEPS = [
  { key: 'upload', label: 'Upload' },
  { key: 'processing', label: 'Processing' },
  { key: 'extracted', label: 'Extracted' },
  { key: 'review', label: 'Review' },
  { key: 'approved', label: 'Approved' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

function currentStep(inv: Invoice): StepKey {
  if (inv.approvalStatus === 'approved') return 'approved';
  if (inv.approvalStatus === 'pending' || inv.status === 'NEEDS_REVIEW') return 'review';
  if (inv.status === 'COMPLETED' || inv.status === 'FAILED') return 'extracted';
  if (inv.status === 'PENDING' || inv.status === 'PROCESSING') return 'processing';
  return 'upload';
}

function stepIndex(key: StepKey): number {
  return STEPS.findIndex((s) => s.key === key);
}

export function StatusTimeline({ inv }: { inv: Invoice }) {
  const current = currentStep(inv);
  const currentIdx = stepIndex(current);

  return (
    <div className="mx-[30px] mt-4 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        {STEPS.map((step, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <div key={step.key} className="flex flex-1 items-center gap-2 min-w-0">
              <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                    done && 'bg-success text-white',
                    active && 'bg-primary text-primary-foreground ring-2 ring-primary/30',
                    !done && !active && 'bg-muted text-faint',
                  )}
                >
                  {done ? '✓' : i + 1}
                </div>
                <span
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-wide truncate w-full text-center',
                    active ? 'text-primary' : done ? 'text-success' : 'text-faint',
                  )}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn('h-0.5 flex-1 min-w-[8px] mb-4', i < currentIdx ? 'bg-success' : 'bg-border')} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
