import { useEffect, useLayoutEffect, useState } from 'react';
import { Button } from '@/components/ui/button.js';
import { clampTooltipPosition, type TourFlowStep } from '../lib/tourFlow.js';

interface Props {
  step: TourFlowStep;
  stepIndex: number;
  total: number;
  waiting: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export function ProductTour({ step, stepIndex, total, waiting, onNext, onBack, onSkip }: Props) {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    function measure() {
      const el = document.querySelector(step.target);
      if (!el) {
        setRect(null);
        return;
      }
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
      setRect(el.getBoundingClientRect());
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    const id = window.setInterval(measure, 500);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
      window.clearInterval(id);
    };
  }, [step.target, waiting]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onSkip();
      if (e.key === 'Enter' || e.key === 'ArrowRight') onNext();
      if (e.key === 'ArrowLeft') onBack();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNext, onBack, onSkip]);

  const last = stepIndex === total - 1;
  const pad = 6;
  const pos = clampTooltipPosition(waiting ? null : rect, step.placement, window.innerWidth, window.innerHeight);
  const huge = !rect || rect.height > window.innerHeight * 0.45 || rect.width > window.innerWidth * 0.75;

  return (
    <div className="fixed inset-0 z-[10000]" data-testid="product-tour" role="dialog" aria-label="Product tour">
      <div className="absolute inset-0 bg-black/40" />
      {rect && !waiting && !huge && (
        <div
          className="pointer-events-none absolute rounded-md ring-2 ring-white/90"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)',
          }}
        />
      )}

      <div
        className="absolute z-20 w-80 rounded-xl border bg-card p-4 text-card-foreground shadow-2xl"
        style={{ top: pos.top, left: pos.left }}
      >
        <p className="text-[11px] font-medium uppercase tracking-wide text-primary">
          Step {stepIndex + 1} of {total}
        </p>
        <h2 className="mt-1 text-base font-semibold" data-testid="tour-title">{step.title}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.content}</p>
        {waiting && (
          <p className="mt-2 text-xs text-primary" data-testid="tour-waiting">
            Loading this screen…
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onSkip} data-testid="tour-skip">
            Skip
          </Button>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onBack}
              disabled={stepIndex === 0}
              data-testid="tour-back"
            >
              Back
            </Button>
            <Button type="button" size="sm" onClick={onNext} data-testid="tour-next">
              {waiting ? 'Skip wait' : last ? 'Done' : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
