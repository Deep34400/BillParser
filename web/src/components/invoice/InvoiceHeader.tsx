import type { Invoice } from '../../types/index.js';
import { api } from '../../api/client.js';
import { StatusDot } from '../StatusDot.js';
import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';

interface InvoiceHeaderProps {
  inv: Invoice;
  editMode: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSave?: () => void;
  onCancel?: () => void;
}

export function InvoiceHeader({ inv, editMode, onEdit, onDelete, onSave, onCancel }: InvoiceHeaderProps) {
  const pdfUrl = api.fileUrl(inv.id);

  return (
    <div className="mx-[30px] mt-4 rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusDot status={inv.status} />
            {inv.verified && <Badge variant="success">✓ Verified</Badge>}
            {inv.approvalStatus === 'approved' && <Badge variant="success">Approved</Badge>}
            {inv.approvalStatus === 'rejected' && <Badge variant="danger">Rejected</Badge>}
          </div>
          <h1 className="text-2xl font-bold text-foreground truncate">
            {inv.invoiceNumber ? `Invoice ${inv.invoiceNumber}` : 'Invoice'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{inv.vendorName ?? '—'}</p>
          {inv.vendorAddress && <p className="mt-0.5 text-xs text-faint">{inv.vendorAddress}</p>}
          {inv.editedAt && (
            <p className="mt-2 text-xs font-medium text-success">✓ Manually corrected — marked verified</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!editMode ? (
            <>
              <Button variant="outline" size="sm" asChild>
                <a href={pdfUrl} target="_blank" rel="noreferrer" download>
                  Download PDF
                </a>
              </Button>
              <Button variant="secondary" size="sm" onClick={onEdit}>
                Edit
              </Button>
              <Button variant="outline" size="sm" className="text-destructive border-destructive/30 hover:bg-danger-soft" onClick={onDelete}>
                Delete
              </Button>
            </>
          ) : (
            <>
              <Button variant="success" size="sm" onClick={onSave}>
                Save & verify
              </Button>
              <Button variant="outline" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
