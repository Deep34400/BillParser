import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AnalyticsPage } from '../src/pages/AnalyticsPage.js';
import { api } from '../src/api/client.js';

/**
 * This used to mock api.analytics — the single heavy endpoint the page called
 * before the backend restructure. The page now fetches several smaller ones
 * (kpis, workshops, months, …), so that mock applied to nothing, the real calls
 * failed, and the page rendered its empty state.
 */
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(api, 'analyticsKpis').mockResolvedValue({
    totalSpend: 350, completedCount: 3, avgConfidence: 0.82, needsReview: 1,
    totalParts: 200, totalLabour: 100, totalTax: 50, vendorCount: 1, vehicleCount: 0,
  } as any);
  vi.spyOn(api, 'analyticsWorkshops').mockResolvedValue({
    workshops: [{ name: 'Globex', amount: 200 }], total: 1,
  } as any);
  vi.spyOn(api, 'analyticsMonths').mockResolvedValue({
    months: [{ label: '2026-01', amount: 150 }], total: 1,
  } as any);
  vi.spyOn(api, 'analyticsVehicles').mockResolvedValue({ vehicles: [], total: 0 } as any);
  vi.spyOn(api, 'analyticsCostkm').mockResolvedValue({ costPerKm: [], total: 0 } as any);
});

it('renders KPIs and the workshop breakdown', async () => {
  render(<AnalyticsPage />);
  await waitFor(() => expect(screen.getByText('Globex')).toBeTruthy());
  // Spend is stored in USD and displayed in rupees, so assert on the amount
  // rather than a currency symbol that depends on the configured FX rate.
  expect(screen.getAllByText(/350/).length).toBeGreaterThan(0);
});
