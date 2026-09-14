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
    request: 'multipart/form-data\nfile: <pdf, image, or zip>\nbatchName: Sep invoices (optional)',
    response: `{
  "created": ["inv_8f2a", "inv_9b1c"],
  "rejected": [],
  "batchId": "bat_1"
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
      batchId: 'filter to one upload batch',
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
    method: 'POST',
    path: '/api/invoices/import',
    auth: 'jwt',
    description: 'Import invoices from http or signed S3 URLs. Creates one batch.',
    request: `{
  "batchName": "S3 dump",
  "sources": [
    "https://bucket.s3.amazonaws.com/a.pdf?X-Amz-Signature=..."
  ]
}`,
    response: `{
  "created": ["inv_8f2a"],
  "rejected": [],
  "batchId": "bat_2"
}`,
    errors: [
      { status: 400, message: 'At least one URL is required' },
      { status: 401, message: 'Authentication required' },
    ],
  },
  {
    method: 'GET',
    path: '/api/batches',
    auth: 'jwt',
    description: 'List your upload batches with status counts.',
    response: `{
  "batches": [
    { "id": "bat_1", "name": "Sep invoices", "source": "files", "total": 5, "completed": 3, "failed": 1, "processing": 1 }
  ]
}`,
    errors: [{ status: 401, message: 'Authentication required' }],
  },
  {
    method: 'GET',
    path: '/api/invoices/batch/:batch_id',
    auth: 'jwt',
    description: 'Bills in a batch plus a status summary.',
    params: { batch_id: 'batch id from upload or import' },
    response: `{
  "batch": { "id": "bat_1", "name": "Sep invoices", "total": 5, "completed": 3, "failed": 1, "processing": 1 },
  "invoices": [{ "id": "inv_8f2a", "status": "COMPLETED" }],
  "summary": { "total": 5, "completed": 3, "failed": 1, "processing": 1, "review": 0 }
}`,
    errors: [
      { status: 401, message: 'Authentication required' },
      { status: 404, message: 'Batch not found' },
    ],
  },
  {
    method: 'POST',
    path: '/api/invoices/batch/:batch_id/retry-failed',
    auth: 'jwt',
    description: 'Re-extract every FAILED invoice in the batch.',
    response: `{ "success": true, "retried": 2 }`,
    errors: [
      { status: 401, message: 'Authentication required' },
      { status: 404, message: 'Batch not found' },
    ],
  },
  {
    method: 'POST',
    path: '/api/invoices/compare',
    auth: 'jwt',
    description: 'Compare two invoices. Send ids, two JSON objects, or two files. Rules compare totals. Optional AI (Settings compare model, Gemini by default) only pairs leftover names, then a second prompt writes the note. Response includes model, validation, and mismatches to review.',
    request: `{
  "mode": "json",
  "ai": true,
  "compareProvider": "gemini",
  "compareModel": "gemini-2.5-flash",
  "left": { "company_name": "Apex", "parts_line_items": [], "totals_and_tax_summary": { "grand_total_invoice": 18650 } },
  "right": { "company_name": "Apex", "parts_line_items": [], "totals_and_tax_summary": { "grand_total_invoice": 19200 } }
}

Also accepted:
{ "id1": "inv_a", "id2": "inv_b", "ai": true }
multipart: fileA + fileB (OCR first, then poll GET /api/invoices/compare?id1=&id2=)`,
    response: `{
  "success": true,
  "data": {
    "header": [{ "field": "company_name", "a": "Apex", "b": "Apex", "status": "match" }],
    "totals": [{ "field": "grand_total_invoice", "a": 18650, "b": 19200, "status": "diff", "delta": 550 }],
    "parts": [{ "status": "same_item", "how": "ai", "a": "Brake pad", "b": "pads" }],
    "counts": { "matched": 1, "changed": 1, "missing": 1, "extra": 1, "aiPairs": 1 },
    "summary": { "rules": "Grand total differs by ₹550.", "ai": "Pads on B is the brake pad from A." },
    "model": { "provider": "gemini", "model": "gemini-2.5-flash", "used": true },
    "validation": { "acceptedAi": 1, "rejectedAi": [], "summaryOk": true, "summaryIssues": [] },
    "mismatches": [{ "kind": "total", "label": "grand total invoice", "detail": "₹18,650 → ₹19,200 (Δ ₹550)", "check": "review" }]
  }
}`,
    errors: [
      { status: 400, message: 'Invoice is still processing' },
      { status: 401, message: 'Authentication required' },
      { status: 404, message: 'Invoice not found' },
    ],
  },
  {
    method: 'GET',
    path: '/api/invoices/compare',
    auth: 'jwt',
    description: 'Compare two already-processed invoices by id.',
    params: { id1: 'invoice id', id2: 'invoice id', ai: '1 (default) or 0', provider: 'optional override', model: 'optional override' },
    response: `{ "success": true, "data": { "summary": { "rules": "…" } } }`,
    errors: [
      { status: 400, message: 'id1 and id2 are required' },
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
