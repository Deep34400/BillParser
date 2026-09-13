import { useState } from 'react';
import type { Invoice } from '../../types/index.js';
import { api } from '../../api/client.js';
import { Badge } from '@/components/ui/badge.js';
import { Button } from '@/components/ui/button.js';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog.js';
import { Textarea } from '@/components/ui/textarea.js';
import { Label } from '@/components/ui/label.js';

interface ApprovalBarProps {
  inv: Invoice;
  onToast: (msg: string) => void;
  onReload: () => void;
}

export function ApprovalBar({ inv, onToast, onReload }: ApprovalBarProps) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const canSubmit =
    inv.approvalStatus !== 'approved'
    && inv.approvalStatus !== 'pending'
    && (inv.status === 'COMPLETED' || inv.status === 'NEEDS_REVIEW' || inv.verified);

  if (!canSubmit && inv.approvalStatus !== 'pending' && inv.approvalStatus !== 'rejected') {
    return null;
  }

  async function handleSubmit() {
    try {
      await api.submitForApproval(inv.id);
      onToast('Submitted — waiting for Org Admin');
      onReload();
    } catch (e) {
      onToast('Failed: ' + (e instanceof Error ? e.message : 'unknown'));
    }
  }

  async function handleApprove() {
    try {
      const r = await api.approve(inv.id);
      onToast((r as { message?: string }).message ?? 'Signed');
      onReload();
    } catch (e) {
      onToast('Failed: ' + (e instanceof Error ? e.message : 'unknown'));
    }
  }

  async function handleReject() {
    if (!rejectReason.trim()) return;
    try {
      await api.reject(inv.id, rejectReason.trim());
      onToast('Invoice rejected');
      setRejectOpen(false);
      setRejectReason('');
      onReload();
    } catch (e) {
      onToast('Failed: ' + (e instanceof Error ? e.message : 'unknown'));
    }
  }

  return (
    <>
      <div className="mx-[30px] mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
        {canSubmit && (
          <Button variant="warning" size="sm" onClick={() => void handleSubmit()}>
            Submit for approval
          </Button>
        )}
        {inv.approvalStatus === 'pending' && (
          <>
            <Badge variant="warning">Pending approval</Badge>
            <Button variant="success" size="sm" onClick={() => void handleApprove()}>
              ✓ Approve
            </Button>
            <Button variant="outline" size="sm" className="text-destructive border-destructive/30" onClick={() => setRejectOpen(true)}>
              ✕ Reject
            </Button>
          </>
        )}
        {inv.approvalStatus === 'rejected' && (
          <Badge variant="danger" title={inv.rejectionReason ?? ''}>
            ✕ REJECTED{inv.rejectionReason ? `: ${inv.rejectionReason}` : ''}
          </Badge>
        )}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject invoice</DialogTitle>
            <DialogDescription>Provide a reason for rejecting this invoice.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reject-reason">Reason</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection…"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" disabled={!rejectReason.trim()} onClick={() => void handleReject()}>
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
