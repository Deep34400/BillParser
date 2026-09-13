import type { FastifyInstance } from 'fastify';

interface Endpoint {
  method: string;
  path: string;
  auth: 'jwt' | 'api-key';
  description: string;
  params?: Record<string, string>;
  request?: string;
  response?: string;
  errors?: Array<{ status: number; message: string }>;
}

const endpoints: Endpoint[] = [
  {
    method: 'POST',
    path: '/api/invoices/upload',
    auth: 'jwt',
    description: 'Upload a PDF or image. OCR starts in the background.',
    request: 'multipart/form-data\nfile: <pdf or image>',
    response: `{
  "success": true,
  "data": {
    "id": "inv_8f2a",
    "status": "PROCESSING"
  }
}`,
    errors: [
      { status: 400, message: 'File is required' },
      { status: 401, message: 'Authentication required' },
      { status: 409, message: 'Duplicate — already uploaded' },
    ],
  },
  {
    method: 'GET',
    path: '/api/invoices',
    auth: 'jwt',
    description: 'List invoices after upload and extract.',
    params: {
      cursor: 'string',
      limit: 'number',
      status: 'PROCESSING | COMPLETED | NEEDS_REVIEW',
      search: 'invoice number, vendor, vehicle',
      vendor: 'company name',
      dateFrom: 'ISO date',
      dateTo: 'ISO date',
      minTotal: 'number',
      maxTotal: 'number',
    },
    response: `{
  "success": true,
  "data": {
    "items": [{ "id": "inv_8f2a", "status": "COMPLETED", "vendorName": "Apex Motors" }],
    "nextCursor": null
  }
}`,
    errors: [
      { status: 401, message: 'Authentication required' },
    ],
  },
  {
    method: 'GET',
    path: '/api/invoices/:id',
    auth: 'jwt',
    description: 'Invoice detail page data — extracted vendor, GSTIN, line items, totals.',
    response: `{
  "success": true,
  "data": {
    "id": "inv_8f2a",
    "status": "COMPLETED",
    "vendorName": "Apex Motors",
    "gstin": "27AABCU9603R1ZM",
    "totalAmount": 18650
  }
}`,
    errors: [
      { status: 401, message: 'Authentication required' },
      { status: 404, message: 'Invoice not found' },
    ],
  },
  {
    method: 'PATCH',
    path: '/api/invoices/:id',
    auth: 'jwt',
    description: 'Correct extracted fields on the detail page.',
    request: `{
  "vendorName": "Apex Motors",
  "totalAmount": 18650
}`,
    response: `{
  "success": true,
  "data": { "id": "inv_8f2a", "vendorName": "Apex Motors" }
}`,
    errors: [
      { status: 400, message: 'Validation failed' },
      { status: 401, message: 'Authentication required' },
      { status: 404, message: 'Invoice not found' },
    ],
  },
  {
    method: 'POST',
    path: '/api/invoices/:id/reextract',
    auth: 'jwt',
    description: 'Run OCR again on the same file.',
    response: `{
  "success": true,
  "data": { "id": "inv_8f2a", "status": "PROCESSING" }
}`,
    errors: [
      { status: 401, message: 'Authentication required' },
      { status: 404, message: 'Invoice not found' },
    ],
  },
  {
    method: 'POST',
    path: '/api/invoices/:id/approve',
    auth: 'jwt',
    description: 'Approve an extracted invoice.',
    response: `{
  "success": true,
  "message": "Approved"
}`,
    errors: [
      { status: 401, message: 'Authentication required' },
      { status: 404, message: 'Invoice not found' },
    ],
  },
  {
    method: 'POST',
    path: '/api/invoices/:id/reject',
    auth: 'jwt',
    description: 'Reject an invoice with a reason.',
    request: `{ "reason": "GST on labour looks high" }`,
    response: `{
  "success": true,
  "message": "Rejected"
}`,
    errors: [
      { status: 400, message: 'Reason is required' },
      { status: 401, message: 'Authentication required' },
      { status: 404, message: 'Invoice not found' },
    ],
  },
  {
    method: 'GET',
    path: '/api/invoices/:id/comments',
    auth: 'jwt',
    description: 'Comments on the invoice detail page.',
    response: `{
  "success": true,
  "data": [{ "text": "Please check GST", "created_at": "2026-09-13T10:00:00.000Z" }]
}`,
    errors: [
      { status: 401, message: 'Authentication required' },
      { status: 404, message: 'Invoice not found' },
    ],
  },
  {
    method: 'POST',
    path: '/api/invoices/:id/comments',
    auth: 'jwt',
    description: 'Add a comment on the detail page.',
    request: `{ "text": "Please check GST" }`,
    response: `{
  "success": true,
  "data": { "text": "Please check GST" }
}`,
    errors: [
      { status: 400, message: 'text must be 1–2000 characters' },
      { status: 401, message: 'Authentication required' },
    ],
  },
  {
    method: 'DELETE',
    path: '/api/invoices/:id',
    auth: 'jwt',
    description: 'Delete an invoice.',
    response: `{ "success": true }`,
    errors: [
      { status: 401, message: 'Authentication required' },
      { status: 404, message: 'Invoice not found' },
    ],
  },
  {
    method: 'GET',
    path: '/api/invoices/export/xlsx',
    auth: 'jwt',
    description: 'Download invoices as Excel. Same filters as the list.',
    response: 'Binary .xlsx file',
    errors: [
      { status: 401, message: 'Authentication required' },
    ],
  },
  {
    method: 'GET',
    path: '/api/invoices/export/csv',
    auth: 'jwt',
    description: 'Download invoices as CSV. Same filters as the list.',
    response: 'text/csv',
    errors: [
      { status: 401, message: 'Authentication required' },
    ],
  },
];

export async function apiDocsRoutes(app: FastifyInstance) {
  app.get('/api/docs', async () => ({
    success: true,
    message: 'Invoice API',
    data: {
      version: '1.0.0',
      baseUrl: '/api',
      authentication: {
        jwt: 'Authorization: Bearer <token> from POST /api/auth/login',
        apiKey: 'x-api-key: <key> from Account',
      },
      errorShape: `{
  "success": false,
  "message": "Invoice not found"
}`,
      endpoints,
    },
    metadata: { total: endpoints.length },
    errors: [],
  }));
}
