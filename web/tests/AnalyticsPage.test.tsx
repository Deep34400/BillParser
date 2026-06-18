import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AnalyticsPage } from '../src/pages/AnalyticsPage.js';
import { api } from '../src/api.js';
it('renders KPIs and vendor/month bars', async () => {
  vi.spyOn(api, 'analytics').mockResolvedValue({ totalSpend: 350, completedCount: 3, avgConfidence: 0.82, needsReview: 1,
    byVendor: [{ name: 'Globex', amount: 200 }], byMonth: [{ label: '2026-01', amount: 150 }] } as any);
  render(<AnalyticsPage />);
  await waitFor(() => expect(screen.getByText('Globex')).toBeTruthy());
  expect(screen.getByText(/\$350\.00/)).toBeTruthy();
});
