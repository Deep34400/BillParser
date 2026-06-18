import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';
import { toCsv } from '../lib/csv.js';
import { buildWhere } from './invoices.js';

const HEADERS = ['id','status','vendorName','invoiceNumber','poNumber','invoiceDate','dueDate','currency','subtotal','taxAmount','totalAmount','provider','confidence','fileName'];
const ITEM_HEADERS = ['invoiceId','vendorName','invoiceNumber','lineNumber','description','sku','quantity','unitPrice','amount','taxRate'];

export async function exportRoutes(app: FastifyInstance) {
  app.get('/api/invoices/export/csv', async (req, reply) => {
    const rows = await prisma.invoice.findMany({ where: buildWhere(req.query as any), orderBy: { createdAt: 'desc' } });
    const csv = toCsv(HEADERS, rows.map((r) => ({ ...r, invoiceDate: r.invoiceDate?.toISOString().slice(0,10), dueDate: r.dueDate?.toISOString().slice(0,10) })));
    reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="invoices.csv"');
    return csv;
  });
  app.get('/api/invoices/export/line-items.csv', async (req, reply) => {
    const invoices = await prisma.invoice.findMany({ where: buildWhere(req.query as any), include: { lineItems: { orderBy: { lineNumber: 'asc' } } } });
    const rows = invoices.flatMap((inv) => inv.lineItems.map((li) => ({ ...li, invoiceId: inv.id, vendorName: inv.vendorName, invoiceNumber: inv.invoiceNumber })));
    reply.header('content-type', 'text/csv').header('content-disposition', 'attachment; filename="line-items.csv"');
    return toCsv(ITEM_HEADERS, rows);
  });
}
