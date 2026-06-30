import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { BakeoffOverlay } from '../src/overlays/BakeoffOverlay.js';
import { api } from '../src/api/client.js';
it('runs bakeoff on open and lists provider cards', async () => {
  vi.spyOn(api, 'bakeoff').mockResolvedValue({ runs: [
    { id: 'r1', provider: 'azure', status: 'COMPLETED', confidence: 0.93, costEstimate: 0.01, latencyMs: 4200, itemsSnapshot: [{}], fieldsSnapshot: { totalAmount: 100 } },
  ] } as any);
  const sel = { id: '1', vendorName: 'Acme', totalAmount: 100 } as any;
  render(<BakeoffOverlay invoice={sel} onClose={() => {}} onApplied={() => {}} />);
  await waitFor(() => expect(screen.getByText('Azure')).toBeTruthy());
  expect(screen.getByText(/93%/)).toBeTruthy();
});
