import { useState, useEffect } from 'react';
import { X, Info } from 'lucide-react';

interface FeatureHintProps {
  id: string;
  message: string;
  onDismiss?: () => void;
}

export function FeatureHint({ id, message, onDismiss }: FeatureHintProps) {
  const storageKey = `hint_dismissed_${id}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(storageKey) !== 'true') setVisible(true);
  }, [storageKey]);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(storageKey, 'true');
    setVisible(false);
    onDismiss?.();
  };

  return (
    <div className="flex items-start gap-3 rounded-lg border border-info/20 bg-info-soft px-4 py-3 text-sm mb-4">
      <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
      <p className="flex-1 text-muted-foreground leading-snug">{message}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss tip"
        className="shrink-0 text-faint hover:text-muted-foreground cursor-pointer"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
