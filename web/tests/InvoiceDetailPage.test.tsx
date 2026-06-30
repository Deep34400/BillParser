import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { InvoiceDetailPage } from '../src/pages/InvoiceDetailPage.js';
import { api } from '../src/api/client.js';
const inv = { id: '1', status: 'COMPLETED', vendorName: 'Acme', vendorAddress: '1 St', vendorTaxId: 'TX1', fileName: 'a.pdf',
  invoiceNumber: 'INV-1', poNumber: 'PO-1', invoiceDate: '2026-01-05', dueDate: '2026-02-05', currency: 'USD',
  subtotal: 90, taxAmount: 10, totalAmount: 100, confidence: 0.9, provider: 'azure', verified: false, error: null,
  lineItems: [{ id: 'li1', lineNumber: 1, description: 'Widget', quantity: 2, unitPrice: 45, amount: 90 }], runs: [] };
beforeEach(() => {
  vi.spyOn(api, 'get').mockResolvedValue(inv as any);
  vi.spyOn(api, 'config').mockResolvedValue({ providers: [{ name: 'azure', displayName: 'Azure', configured: true }] } as any);
});
it('renders header fields and line items', async () => {
  render(<MemoryRouter initialEntries={['/invoices/1']}><Routes><Route path="/invoices/:id" element={<InvoiceDetailPage />} /></Routes></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
  expect(screen.getByText('Widget')).toBeTruthy();
  expect(screen.getByText('INV-1')).toBeTruthy();
});
it('enters edit mode and saves', async () => {
  const patch = vi.spyOn(api, 'patch').mockResolvedValue(inv as any);
  render(<MemoryRouter initialEntries={['/invoices/1']}><Routes><Route path="/invoices/:id" element={<InvoiceDetailPage />} /></Routes></MemoryRouter>);
  await waitFor(() => screen.getByText('Edit fields'));
  fireEvent.click(screen.getByText('Edit fields'));
  fireEvent.click(screen.getByText('Save & verify'));
  await waitFor(() => expect(patch).toHaveBeenCalled());
});
