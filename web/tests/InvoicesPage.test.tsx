import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InvoicesPage } from '../src/pages/InvoicesPage.js';
import { api } from '../src/api.js';
beforeEach(() => {
  vi.spyOn(api, 'list').mockResolvedValue({ invoices: [
    { id: '1', status: 'COMPLETED', vendorName: 'Acme', invoiceNumber: 'INV-1', invoiceDate: '2026-01-05', provider: 'azure', confidence: 0.9, itemCount: 3, totalAmount: 100, verified: false },
  ] } as any);
  vi.spyOn(api, 'config').mockResolvedValue({ providers: [] } as any);
});
it('renders rows from the API', async () => {
  render(<MemoryRouter><InvoicesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
  expect(screen.getByText('INV-1')).toBeTruthy();
});
