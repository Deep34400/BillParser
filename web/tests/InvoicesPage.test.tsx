import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InvoicesPage } from '../src/pages/InvoicesPage.js';
import { api } from '../src/api.js';

beforeEach(() => {
  vi.spyOn(api, 'list').mockResolvedValue({ invoices: [
    { id: '1', status: 'COMPLETED', vendorName: 'Acme', invoiceNumber: 'INV-1', invoiceDate: '2026-01-05', provider: 'azure', confidence: 0.9, itemCount: 3, totalAmount: 100, verified: false, batchId: 'b1', batch: { id: 'b1', name: 'April bills' } },
    { id: '2', status: 'COMPLETED', vendorName: 'Globex', invoiceNumber: 'INV-2', invoiceDate: '2026-02-05', provider: 'azure', confidence: 0.9, itemCount: 1, totalAmount: 50, verified: false, batchId: 'b2', batch: { id: 'b2', name: 'March recon' } },
  ] } as any);
  vi.spyOn(api, 'config').mockResolvedValue({ providers: [] } as any);
  vi.spyOn(api, 'batches').mockResolvedValue({ batches: [
    { id: 'b1', name: 'April bills', createdAt: '2026-04-01', total: 1, completed: 1, failed: 0, processing: 0 },
    { id: 'b2', name: 'March recon', createdAt: '2026-03-01', total: 1, completed: 1, failed: 0, processing: 0 },
  ] } as any);
});

it('renders rows from the API', async () => {
  render(<MemoryRouter><InvoicesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
  expect(screen.getByText('INV-1')).toBeTruthy();
});

it('filters the table to the selected batch', async () => {
  render(<MemoryRouter><InvoicesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
  expect(screen.getByText('Globex')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Filter by batch'), { target: { value: 'b1' } });
  await waitFor(() => expect(screen.queryByText('Globex')).toBeNull());
  expect(screen.getByText('Acme')).toBeTruthy();
});

it('imports pasted URLs/paths via the Import button', async () => {
  const spy = vi.spyOn(api, 'importSources').mockResolvedValue({ created: [{}], duplicates: [], rejected: [] } as any);
  render(<MemoryRouter><InvoicesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Upload bills' }));
  fireEvent.change(screen.getByLabelText('Import URLs or paths'), {
    target: { value: 'https://x.com/a.pdf\n\n/data/import/b.pdf\n' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  await waitFor(() => expect(spy).toHaveBeenCalledWith(['https://x.com/a.pdf', '/data/import/b.pdf'], undefined));
});

it('disables the Import button while a request is in flight (no double-submit)', async () => {
  let resolve!: (v: unknown) => void;
  const spy = vi.spyOn(api, 'importSources').mockReturnValue(new Promise((r) => { resolve = r; }) as any);
  render(<MemoryRouter><InvoicesPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText('Acme')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Upload bills' }));
  fireEvent.change(screen.getByLabelText('Import URLs or paths'), { target: { value: 'https://x.com/a.pdf' } });
  fireEvent.click(screen.getByRole('button', { name: 'Import' }));
  // Button shows the in-flight label and is disabled; a second click must not fire another request.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Importing…' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Importing…' }));
  expect(spy).toHaveBeenCalledTimes(1);
  resolve({ created: [{}], duplicates: [], rejected: [] });
});
