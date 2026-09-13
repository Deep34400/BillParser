import { it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { useTour } from '../src/components/GuidedTour.js';

function Pages() {
  return (
    <Routes>
      <Route
        path="/invoices"
        element={(
          <div>
            <button type="button" data-tour="upload">Upload bills</button>
            <div data-tour="filters">Processing Completed</div>
            <div data-tour="invoice-list" data-tour-invoice-id="inv-1">Invoice list</div>
            <button type="button" data-tour="nav-help">Help</button>
          </div>
        )}
      />
      <Route
        path="/invoices/:id"
        element={(
          <div>
            <div data-tour="detail-status">Uploaded Processing Extracted</div>
            <div data-tour="detail-fields">GSTIN Vehicle</div>
          </div>
        )}
      />
      <Route path="/analytics" element={<div data-tour="analytics-kpis">Total spend</div>} />
      <Route path="/account" element={<div data-tour="account-apikey">Generate Key</div>} />
    </Routes>
  );
}

function Harness() {
  const { startTour, TourComponent } = useTour();
  return (
    <>
      <button type="button" onClick={startTour}>Start tour</button>
      {TourComponent}
      <Pages />
    </>
  );
}

function renderTour() {
  return render(
    <MemoryRouter initialEntries={['/invoices']}>
      <Harness />
    </MemoryRouter>,
  );
}

async function clickNext() {
  fireEvent.click(screen.getByTestId('tour-next'));
}

it('Take a tour Next walks list, detail, analytics, and API key', async () => {
  renderTour();
  fireEvent.click(screen.getByText('Start tour'));

  await waitFor(() => expect(screen.getByTestId('product-tour')).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId('tour-title').textContent).toMatch(/Upload invoice/));

  await clickNext();
  await waitFor(() => expect(screen.getByTestId('tour-title').textContent).toMatch(/Processing/));

  await clickNext();
  await waitFor(() => expect(screen.getByTestId('tour-title').textContent).toMatch(/Extract done/));

  await clickNext();
  await waitFor(() => expect(screen.getByTestId('tour-title').textContent).toMatch(/Invoice detail/));
  expect(screen.getByText(/Uploaded Processing Extracted/)).toBeTruthy();

  await clickNext();
  await waitFor(() => expect(screen.getByTestId('tour-title').textContent).toMatch(/Extracted data/));

  await clickNext();
  await waitFor(() => expect(screen.getByTestId('tour-title').textContent).toMatch(/Analytics/));
  expect(screen.getByText('Total spend')).toBeTruthy();

  await clickNext();
  await waitFor(() => expect(screen.getByTestId('tour-title').textContent).toMatch(/API key/));
  expect(screen.getByText('Generate Key')).toBeTruthy();

  await clickNext();
  await waitFor(() => expect(screen.getByTestId('tour-title').textContent).toMatch(/Help/));

  fireEvent.click(screen.getByTestId('tour-next'));
  await waitFor(() => expect(screen.queryByTestId('product-tour')).toBeNull());
});

it('Skip closes the tour', async () => {
  renderTour();
  fireEvent.click(screen.getByText('Start tour'));
  await waitFor(() => expect(screen.getByTestId('product-tour')).toBeTruthy());
  fireEvent.click(screen.getByTestId('tour-skip'));
  await waitFor(() => expect(screen.queryByTestId('product-tour')).toBeNull());
});
