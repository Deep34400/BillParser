import { useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils.js';

export interface DocItem {
  term: string;
  desc: string;
}

interface Props {
  title: string;
  subtitle?: string;
  items: DocItem[];
  defaultOpen?: boolean;
}

export function DocNote({ title, subtitle, items, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <Info className="h-4 w-4 text-primary shrink-0" />
        <span className="flex-1">{title}</span>
        {open ? <ChevronDown className="h-4 w-4 text-faint" /> : <ChevronRight className="h-4 w-4 text-faint" />}
      </button>

      {open && (
        <div className="border-t border-border px-4 py-3 space-y-2">
          {subtitle && <p className="text-xs text-muted-foreground mb-3">{subtitle}</p>}
          <dl className="space-y-2">
            {items.map(({ term, desc }) => (
              <div key={term} className="flex gap-2 text-xs">
                <dt className="font-mono font-semibold text-foreground whitespace-nowrap">{term}</dt>
                <dd className="text-muted-foreground">{desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
