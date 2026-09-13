/**
 * Zod-based request validation helpers and route schemas.
 */
import { z } from 'zod';
import { ValidationError } from './errors.js';

function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => {
    const path = i.path.length ? i.path.join('.') : 'body';
    return `${path}: ${i.message}`;
  }).join('; ');
}

export function validateBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(formatZodError(result.error));
  }
  return result.data;
}

export function validateQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw new ValidationError(formatZodError(result.error));
  }
  return result.data;
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── Invoices ───────────────────────────────────────────────────────────────

export const commentBodySchema = z.object({
  text: z.string().min(1).max(2000),
});

export const invoiceUpdateBodySchema = z.object({
  vendorName: z.string().optional(),
  vendorTaxId: z.string().optional(),
  invoiceNumber: z.string().optional(),
  invoiceDate: z.string().optional(),
  totalAmount: z.number().optional(),
  subtotal: z.number().optional(),
}).strict();

export const invoiceExportQuerySchema = z.object({
  status: z.string().optional(),
  q: z.string().optional(),
  needsReview: z.enum(['0', '1', 'true', 'false']).optional(),
  completed: z.enum(['0', '1', 'true', 'false']).optional(),
  review_code: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  minTotal: z.string().optional(),
});

// ─── Webhooks ───────────────────────────────────────────────────────────────

export const webhookCreateBodySchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  description: z.string().optional(),
});

// ─── Settings ───────────────────────────────────────────────────────────────

export const settingsUpdateBodySchema = z.object({}).passthrough();
