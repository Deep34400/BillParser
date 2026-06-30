import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { resolveSource } from '../lib/fetchSource.js';
import { isPdf } from '../lib/pdf.js';
import { parseInvoiceBuffer } from '../extraction/parseOnce.js';
import { toApiParsed } from '../response/apiResponse.js';
import type { CanonicalResult } from '../providers/types.js';
import type { ParsedInvoiceData } from '../parsing/types.js';

// Build parsed_data from the canonical result; fall back to canonical fields if the provider
// returned no parsedData (keeps non-markdown providers working).
function toParsed(r: CanonicalResult): ParsedInvoiceData {
  if (r.parsedData) return r.parsedData;
  return {
    company_name: r.vendorName ?? null,
    gstin: r.vendorTaxId ?? null,
    invoice_number: r.invoiceNumber ?? null,
    invoice_date: r.invoiceDate ?? null,
    totals_and_tax_summary: {
      parts_discount: r.discountAmount ?? null,
      parts_cgst_amount: r.cgstAmount ?? null,
      parts_sgst_amount: r.sgstAmount ?? null,
      parts_igst_amount: r.igstAmount ?? null,
      grand_total_invoice: r.totalAmount ?? null,
    },
    confidence: r.confidence ?? null,
  };
}

export async function parseRoutes(app: FastifyInstance) {
  // Stateless one-shot parse. Accepts EITHER a multipart PDF upload (field name any) OR a JSON
  // body { "source": "<https/s3 url>" }. Returns the structured invoice in the same response.
  app.post('/api/parse', async (req, reply) => {
    let buf: Buffer | null = null;
    let fileName = 'invoice.pdf';
    let provider: string | undefined;

    const ctype = String(req.headers['content-type'] ?? '');
    if (ctype.includes('multipart/form-data')) {
      for await (const part of (req as any).parts()) {
        if (part.type === 'file') {
          buf = await part.toBuffer();
          fileName = part.filename || fileName;
        } else if (part.fieldname === 'provider' && part.value) {
          provider = String(part.value);
        }
      }
    } else {
      const body = (req.body ?? {}) as { source?: string; url?: string; provider?: string };
      const source = body.source ?? body.url;
      provider = body.provider;
      if (!source || typeof source !== 'string') {
        return reply.code(400).send({ error: 'provide a PDF file (multipart) or JSON { "source": "<url>" }' });
      }
      try {
        const fetched = await resolveSource(source);
        buf = fetched.buf;
        fileName = fetched.fileName;
      } catch (e) {
        return reply.code(400).send({ error: e instanceof Error ? e.message : 'failed to fetch source' });
      }
    }

    if (!buf) return reply.code(400).send({ error: 'no PDF provided' });
    if (!isPdf(buf)) return reply.code(415).send({ error: 'not a PDF' });

    try {
      const { result } = await parseInvoiceBuffer(buf, { fileName, provider });
      return { output: { entries: [{ id: randomUUID(), parsed_data: toApiParsed(toParsed(result)) }] } };
    } catch (e) {
      return reply.code(502).send({ error: e instanceof Error ? e.message : 'extraction failed' });
    }
  });
}
