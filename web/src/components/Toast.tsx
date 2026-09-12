import { cn } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import { X } from 'lucide-react';

interface Props {
  message: string;
  variant?: 'default' | 'success' | 'error';
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
}

export function Toast({ message, variant = 'default', actionLabel, onAction, onClose }: Props) {
  return (
    <div className={cn(
      'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg text-sm font-medium',
      'animate-in slide-in-from-bottom-4 fade-in-0 duration-300',
      variant === 'success' && 'bg-success text-white',
      variant === 'error' && 'bg-danger text-white',
      variant === 'default' && 'bg-foreground text-card',
    )}>
      <span>{message}</span>
      {actionLabel && onAction && (
        <Button variant="ghost" size="sm" className="text-white/90 hover:text-white hover:bg-white/10" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
      {onClose && (
        <button onClick={onClose} className="ml-1 rounded-sm p-0.5 opacity-70 hover:opacity-100 transition-opacity cursor-pointer">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
