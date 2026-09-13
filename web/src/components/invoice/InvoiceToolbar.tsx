import type { Invoice, AppConfig } from '../../types/index.js';
import { Button } from '@/components/ui/button.js';
import { cn } from '@/lib/utils.js';

interface InvoiceToolbarProps {
  inv: Invoice;
  config: AppConfig | null;
  editMode: boolean;
  processing: boolean;
  pdfOpen: boolean;
  reProvider: string;
  onReProviderChange: (v: string) => void;
  onReextract: () => void;
  onCompare: () => void;
  onBakeoff: () => void;
  onTogglePdf: () => void;
}

export function InvoiceToolbar({
  config, editMode, processing, pdfOpen, reProvider,
  onReProviderChange, onReextract, onCompare, onBakeoff, onTogglePdf,
}: InvoiceToolbarProps) {
  if (editMode) return null;

  return (
    <div className="mx-[30px] mt-3 flex flex-wrap items-center gap-2">
      {config && config.providers.length > 0 && (
        <select
          value={reProvider}
          onChange={(e) => onReProviderChange(e.target.value)}
          className="h-8 rounded-md border border-input bg-card px-2.5 text-sm text-foreground"
        >
          {config.providers.map((p) => (
            <option key={p.name} value={p.name}>{p.displayName}</option>
          ))}
        </select>
      )}
      <Button variant="outline" size="sm" disabled={processing} onClick={onReextract}>
        {processing ? 'Processing…' : 'Re-extract'}
      </Button>
      <Button variant="outline" size="sm" onClick={onCompare}>Compare source</Button>
      <Button variant="outline" size="sm" onClick={onBakeoff}>Bake-off</Button>
      <Button
        variant="outline"
        size="sm"
        className={cn(pdfOpen && 'border-primary bg-info-soft text-primary')}
        onClick={onTogglePdf}
      >
        {pdfOpen ? '✕ Hide PDF' : 'View PDF'}
      </Button>
    </div>
  );
}
