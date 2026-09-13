import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetBill = vi.hoisted(() => vi.fn());
const mockUpdateBill = vi.hoisted(() => vi.fn());

vi.mock('../../../src/ocr/repository.js', () => ({
  getBill: mockGetBill,
  updateBill: mockUpdateBill,
}));

vi.mock('../../../src/shared/cache.js', () => ({
  cacheInvalidate: vi.fn(),
}));

vi.mock('../../../src/ocr/service/recordActivity.js', () => ({
  recordActivity: vi.fn(),
}));

import {
  submitForApproval,
  approveInvoice,
  rejectInvoice,
} from '../../../src/ocr/service/invoiceService.js';
import { ValidationError } from '../../../src/shared/errors.js';
import type { BillDoc } from '../../../src/shared/types.js';

function bill(overrides: Partial<BillDoc> = {}): BillDoc {
  return {
    bill_id: 'bill-1',
    bill_type: 'MAINTENANCE',
    ocr_status: 'OCR_COMPLETED',
    schema_version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  } as BillDoc;
}

describe('submitForApproval', () => {
  beforeEach(() => {
    mockGetBill.mockReset();
    mockUpdateBill.mockReset();
  });

  it('requires OCR_COMPLETED status (rejects PROCESSING)', async () => {
    mockGetBill.mockResolvedValue(bill({ ocr_status: 'PROCESSING' }));

    await expect(submitForApproval('bill-1', 'user-1')).rejects.toThrow(ValidationError);
    await expect(submitForApproval('bill-1', 'user-1')).rejects.toThrow(/Cannot submit for approval/);
    expect(mockUpdateBill).not.toHaveBeenCalled();
  });

  it('succeeds when ocr_status is OCR_COMPLETED', async () => {
    mockGetBill.mockResolvedValue(bill({ ocr_status: 'OCR_COMPLETED' }));
    mockUpdateBill.mockResolvedValue(undefined);

    await submitForApproval('bill-1', 'user-1');

    expect(mockUpdateBill).toHaveBeenCalledWith(
      'bill-1',
      expect.objectContaining({
        approval_status: 'pending',
        submitted_by: 'user-1',
      }),
    );
  });
});

describe('approveInvoice', () => {
  beforeEach(() => {
    mockGetBill.mockReset();
    mockUpdateBill.mockReset();
  });

  it('requires PENDING_APPROVAL status', async () => {
    mockGetBill.mockResolvedValue(bill({ approval_status: 'approved' }));

    await expect(approveInvoice('bill-1', 'admin-1')).rejects.toThrow(ValidationError);
    await expect(approveInvoice('bill-1', 'admin-1')).rejects.toThrow('Invoice is not pending approval');
    expect(mockUpdateBill).not.toHaveBeenCalled();
  });

  it('approves when approval_status is pending', async () => {
    mockGetBill.mockResolvedValue(bill({ approval_status: 'pending' }));
    mockUpdateBill.mockResolvedValue(undefined);

    const result = await approveInvoice('bill-1', 'admin-1');

    expect(result).toEqual({ approved: true, nextStep: null });
    expect(mockUpdateBill).toHaveBeenCalledWith(
      'bill-1',
      expect.objectContaining({
        approval_status: 'approved',
        approved_by: 'admin-1',
      }),
    );
  });
});

describe('rejectInvoice', () => {
  beforeEach(() => {
    mockGetBill.mockReset();
    mockUpdateBill.mockReset();
  });

  it('requires PENDING_APPROVAL status', async () => {
    mockGetBill.mockResolvedValue(bill({ approval_status: 'rejected' }));

    await expect(rejectInvoice('bill-1', 'admin-1', 'bad data')).rejects.toThrow(ValidationError);
    await expect(rejectInvoice('bill-1', 'admin-1', 'bad data')).rejects.toThrow(
      'Invoice is not pending approval',
    );
    expect(mockUpdateBill).not.toHaveBeenCalled();
  });

  it('requires a non-empty reason string', async () => {
    mockGetBill.mockResolvedValue(bill({ approval_status: 'pending' }));

    await expect(rejectInvoice('bill-1', 'admin-1', '   ')).rejects.toThrow(ValidationError);
    await expect(rejectInvoice('bill-1', 'admin-1', '   ')).rejects.toThrow('Rejection reason is required');
    expect(mockUpdateBill).not.toHaveBeenCalled();
  });

  it('rejects with trimmed reason when pending', async () => {
    mockGetBill.mockResolvedValue(bill({ approval_status: 'pending' }));
    mockUpdateBill.mockResolvedValue(undefined);

    await rejectInvoice('bill-1', 'admin-1', ' Invalid totals ');

    expect(mockUpdateBill).toHaveBeenCalledWith(
      'bill-1',
      expect.objectContaining({
        approval_status: 'rejected',
        rejection_reason: 'Invalid totals',
      }),
    );
  });
});
