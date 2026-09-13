export interface TutorialSlide {
  id: string;
  step: string;
  title: string;
  narrate: string;
  mock: string;
}

export const TUTORIAL_SLIDES: TutorialSlide[] = [
  {
    id: 'list',
    step: 'Home',
    title: 'Your invoices',
    narrate: 'This is home. Every bill you upload appears here with its OCR status.',
    mock: 'invoices',
  },
  {
    id: 'upload',
    step: 'Upload',
    title: 'Upload a bill',
    narrate: 'Click Upload bills or drop a PDF or image. You can send several files at once.',
    mock: 'upload',
  },
  {
    id: 'process',
    step: 'Extract',
    title: 'OCR is processing',
    narrate: 'Status becomes Processing. We read vendor, GSTIN, vehicle, and totals in the background.',
    mock: 'processing',
  },
  {
    id: 'detail',
    step: 'Detail',
    title: 'Open the invoice',
    narrate: 'Click a completed row. The detail page shows the extract — timeline, vendor, and actions.',
    mock: 'detail-page',
  },
  {
    id: 'fields',
    step: 'Fields',
    title: 'Check extracted data',
    narrate: 'Company, GSTIN, PAN, date, vehicle, chassis, and odometer come from OCR. Edit if something is wrong.',
    mock: 'detail-fields',
  },
  {
    id: 'analytics',
    step: 'Analytics',
    title: 'See spend and charts',
    narrate: 'Analytics shows total spend, workshops, and vehicles after invoices are extracted.',
    mock: 'analytics',
  },
  {
    id: 'apikey',
    step: 'Account',
    title: 'Get your API key',
    narrate: 'Open Account, click Generate Key, and copy it once. Send it as x-api-key when you call the invoice API.',
    mock: 'apikey',
  },
  {
    id: 'done',
    step: 'Done',
    title: 'Export and help',
    narrate: 'Export CSV or Excel from the list. Help always has this tutorial, the user guide, and the API reference.',
    mock: 'export',
  },
];
