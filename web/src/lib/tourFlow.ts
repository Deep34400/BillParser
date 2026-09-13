export type TourRoute = 'list' | 'detail' | 'analytics' | 'account';

export interface TourFlowStep {
  route: TourRoute;
  target: string;
  title: string;
  content: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
}

export const TOUR_FLOW: TourFlowStep[] = [
  {
    route: 'list',
    target: '[data-tour="upload"]',
    title: '1. Upload invoice',
    content: 'Upload a PDF or image. You can drop several files at once.',
    placement: 'bottom',
  },
  {
    route: 'list',
    target: '[data-tour="filters"]',
    title: '2. Processing',
    content: 'After upload, status is Processing while OCR extracts vendor, GSTIN, and totals.',
    placement: 'bottom',
  },
  {
    route: 'list',
    target: '[data-tour="invoice-list"]',
    title: '3. Extract done',
    content: 'When status is Completed or Needs Review, click the invoice to open the detail page.',
    placement: 'top',
  },
  {
    route: 'detail',
    target: '[data-tour="detail-status"]',
    title: '4. Invoice detail',
    content: 'This is the detail page after extract. The timeline shows Uploaded, Processing, Extracted, Review, and Approved.',
    placement: 'bottom',
  },
  {
    route: 'detail',
    target: '[data-tour="detail-fields"]',
    title: '5. Extracted data',
    content: 'Company name, GSTIN, PAN, date, vehicle, and totals come from OCR. Edit a field if it is wrong.',
    placement: 'bottom',
  },
  {
    route: 'analytics',
    target: '[data-tour="analytics-kpis"]',
    title: '6. Analytics',
    content: 'Spend, workshops, and vehicles appear here after invoices are extracted.',
    placement: 'bottom',
  },
  {
    route: 'account',
    target: '[data-tour="account-apikey"]',
    title: '7. API key',
    content: 'On Account, click Generate Key and copy it once. Send it as x-api-key on invoice APIs.',
    placement: 'bottom',
  },
  {
    route: 'list',
    target: '[data-tour="nav-help"]',
    title: '8. Help',
    content: 'Watch tutorial or open the user guide anytime from Help.',
    placement: 'top',
  },
];

export function tourPathFor(route: TourRoute, invoiceId: string | null): string {
  if (route === 'analytics') return '/analytics';
  if (route === 'account') return '/account';
  if (route === 'detail') return invoiceId ? `/invoices/${invoiceId}` : '/invoices';
  return '/invoices';
}

export function firstInvoiceIdFromDom(root: ParentNode = document): string | null {
  return root.querySelector('[data-tour-invoice-id]')?.getAttribute('data-tour-invoice-id') ?? null;
}

export async function waitForSelector(
  selector: string,
  timeoutMs = 8000,
  intervalMs = 150,
  root: ParentNode = document,
): Promise<Element | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const el = root.querySelector(selector);
    if (el) return el;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return root.querySelector(selector);
}

export function clampTooltipPosition(
  rect: DOMRect | null,
  placement: TourFlowStep['placement'],
  vw: number,
  vh: number,
): { top: number; left: number } {
  const width = 320;
  const height = 220;
  const huge = !rect || rect.height > vh * 0.45 || rect.width > vw * 0.75;
  if (huge) {
    return {
      top: Math.max(16, (vh - height) / 2),
      left: Math.max(16, (vw - width) / 2),
    };
  }
  let left = Math.min(Math.max(16, rect.left), Math.max(16, vw - width - 16));
  let top = placement === 'top' ? rect.top - height - 12 : rect.bottom + 12;
  if (placement === 'left' || placement === 'right') top = Math.max(16, rect.top);
  if (top + height > vh - 16) top = Math.max(16, vh - height - 16);
  if (top < 16) top = 16;
  return { top, left };
}

export function nextTourIndex(
  currentIndex: number,
  action: 'next' | 'prev',
  total = TOUR_FLOW.length,
): number {
  if (action === 'prev') return Math.max(0, currentIndex - 1);
  return currentIndex + 1 >= total ? -1 : currentIndex + 1;
}
