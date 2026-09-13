import { it, expect } from 'vitest';
import {
  TOUR_FLOW,
  clampTooltipPosition,
  firstInvoiceIdFromDom,
  nextTourIndex,
  tourPathFor,
  waitForSelector,
} from '../src/lib/tourFlow.js';

it('tour visits detail, then analytics, then account API key', () => {
  const routes = TOUR_FLOW.map((s) => s.route);
  expect(routes).toContain('detail');
  expect(routes).toContain('analytics');
  expect(routes).toContain('account');

  const detailIdx = routes.lastIndexOf('detail');
  const analyticsIdx = routes.indexOf('analytics');
  const accountIdx = routes.indexOf('account');
  expect(analyticsIdx).toBeGreaterThan(detailIdx);
  expect(accountIdx).toBeGreaterThan(analyticsIdx);
  expect(TOUR_FLOW[accountIdx].target).toBe('[data-tour="account-apikey"]');
  expect(TOUR_FLOW[analyticsIdx].target).toBe('[data-tour="analytics-kpis"]');
});

it('builds the right path for each tour route', () => {
  expect(tourPathFor('list', 'inv_1')).toBe('/invoices');
  expect(tourPathFor('detail', 'inv_1')).toBe('/invoices/inv_1');
  expect(tourPathFor('detail', null)).toBe('/invoices');
  expect(tourPathFor('analytics', null)).toBe('/analytics');
  expect(tourPathFor('account', null)).toBe('/account');
});

it('advances next and prev without wrapping past the end', () => {
  expect(nextTourIndex(4, 'next')).toBe(5);
  expect(nextTourIndex(TOUR_FLOW.length - 1, 'next')).toBe(-1);
  expect(nextTourIndex(0, 'prev')).toBe(0);
  expect(nextTourIndex(3, 'prev')).toBe(2);
});

it('reads the first invoice id from the list', () => {
  const root = document.createElement('div');
  root.innerHTML = '<div data-tour-invoice-id="bill-99"></div>';
  expect(firstInvoiceIdFromDom(root)).toBe('bill-99');
});

it('keeps the tour card on screen when the target is the whole analytics page', () => {
  const huge = { top: 0, left: 0, width: 1200, height: 2000, bottom: 2000, right: 1200 } as DOMRect;
  const pos = clampTooltipPosition(huge, 'bottom', 1280, 800);
  expect(pos.top).toBeGreaterThanOrEqual(16);
  expect(pos.top + 220).toBeLessThanOrEqual(800);
  expect(pos.left).toBeGreaterThanOrEqual(16);
});

it('waits until a late API target appears', async () => {
  const root = document.createElement('div');
  window.setTimeout(() => {
    const el = document.createElement('div');
    el.setAttribute('data-tour', 'analytics-kpis');
    root.appendChild(el);
  }, 80);
  const found = await waitForSelector('[data-tour="analytics-kpis"]', 1000, 20, root);
  expect(found).toBeTruthy();
});
