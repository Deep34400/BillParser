import { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, X } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import { Card } from '@/components/ui/card.js';

export type UploadFileEntry = {
  name: string;
  status: 'uploading' | 'processing' | 'done' | 'failed';
  error?: string;
};

interface Props {
  files: UploadFileEntry[];
}

export function UploadProgress({ files }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const doneCount = files.filter((f) => f.status === 'done').length;
  const total = files.length;

  return (
    <Card className="mx-7 mb-3 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold text-foreground hover:bg-muted/50 transition-colors cursor-pointer"
      >
        <span>
          {doneCount} of {total} complete
        </span>
        {collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
      </button>

      {!collapsed && (
        <ul className="border-t border-border divide-y divide-border">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="flex items-start gap-3 px-4 py-2 text-sm">
              <StatusIcon status={file.status} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{file.name}</p>
                {file.status === 'failed' && file.error && (
                  <p className="mt-0.5 text-xs text-destructive">{file.error}</p>
                )}
              </div>
              <StatusLabel status={file.status} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StatusIcon({ status }: { status: UploadFileEntry['status'] }) {
  if (status === 'uploading') {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary mt-0.5" />;
  }
  if (status === 'processing') {
    return <Loader2 className="h-4 w-4 shrink-0 animate-spin text-warning mt-0.5" />;
  }
  if (status === 'done') {
    return <Check className="h-4 w-4 shrink-0 text-success mt-0.5" />;
  }
  return <X className="h-4 w-4 shrink-0 text-destructive mt-0.5" />;
}

function StatusLabel({ status }: { status: UploadFileEntry['status'] }) {
  const labels: Record<UploadFileEntry['status'], string> = {
    uploading: 'Uploading',
    processing: 'Processing',
    done: 'Done',
    failed: 'Failed',
  };
  return (
    <span
      className={cn(
        'shrink-0 text-xs font-medium',
        status === 'done' && 'text-success',
        status === 'failed' && 'text-destructive',
        status === 'processing' && 'text-warning',
        status === 'uploading' && 'text-muted-foreground',
      )}
    >
      {labels[status]}
    </span>
  );
}
