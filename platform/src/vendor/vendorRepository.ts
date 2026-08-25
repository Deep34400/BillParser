/**
 * Vendor Repository — Postgres CRUD for the `vendors` table.
 * Pure data-access layer. No business logic.
 */
import { desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../config/db.js';
import { vendors } from '../db/schema.js';
import type { VendorDoc } from './vendorTypes.js';

function rowToDoc(row: typeof vendors.$inferSelect): VendorDoc {
  return {
    vendor_id: row.vendorId,
    legal_name: row.legalName,
    display_name: row.displayName,
    gstin: row.gstin,
    pan: row.pan,
    invoice_count: row.invoiceCount,
    first_seen: row.firstSeen.toISOString(),
    last_seen: row.lastSeen.toISOString(),
    parser_name: row.parserName,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function docToRow(v: VendorDoc) {
  return {
    vendorId: v.vendor_id,
    legalName: v.legal_name,
    displayName: v.display_name,
    gstin: v.gstin,
    pan: v.pan,
    invoiceCount: v.invoice_count,
    firstSeen: new Date(v.first_seen),
    lastSeen: new Date(v.last_seen),
    parserName: v.parser_name,
    createdAt: new Date(v.created_at),
    updatedAt: new Date(v.updated_at),
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function createVendor(vendor: VendorDoc): Promise<VendorDoc> {
  await db().insert(vendors).values(docToRow(vendor));
  return vendor;
}

export async function getVendor(vendorId: string): Promise<VendorDoc | null> {
  const [row] = await db().select().from(vendors).where(eq(vendors.vendorId, vendorId)).limit(1);
  return row ? rowToDoc(row) : null;
}

export async function updateVendor(vendorId: string, updates: Partial<VendorDoc>): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.legal_name !== undefined) patch.legalName = updates.legal_name;
  if (updates.display_name !== undefined) patch.displayName = updates.display_name;
  if (updates.gstin !== undefined) patch.gstin = updates.gstin;
  if (updates.pan !== undefined) patch.pan = updates.pan;
  if (updates.invoice_count !== undefined) patch.invoiceCount = updates.invoice_count;
  if (updates.first_seen !== undefined) patch.firstSeen = new Date(updates.first_seen);
  if (updates.last_seen !== undefined) patch.lastSeen = new Date(updates.last_seen);
  if (updates.parser_name !== undefined) patch.parserName = updates.parser_name;

  await db().update(vendors).set(patch).where(eq(vendors.vendorId, vendorId));
}

export async function listVendors(opts: { limit?: number; offset?: number } = {}): Promise<VendorDoc[]> {
  const rows = await db().select().from(vendors)
    .orderBy(desc(vendors.invoiceCount))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);
  return rows.map(rowToDoc);
}

// ─── Lookup helpers (for matching) ──────────────────────────────────────────

export async function findByGstin(gstin: string): Promise<VendorDoc | null> {
  const [row] = await db().select().from(vendors).where(eq(vendors.gstin, gstin)).limit(1);
  return row ? rowToDoc(row) : null;
}

export async function findByPan(pan: string): Promise<VendorDoc | null> {
  const [row] = await db().select().from(vendors).where(eq(vendors.pan, pan)).limit(1);
  return row ? rowToDoc(row) : null;
}

export async function findByLegalName(name: string): Promise<VendorDoc | null> {
  const [row] = await db().select().from(vendors)
    .where(sql`lower(${vendors.legalName}) = lower(${name})`).limit(1);
  return row ? rowToDoc(row) : null;
}

export async function searchVendors(q: string, limit = 20): Promise<VendorDoc[]> {
  const pattern = `%${q}%`;
  const rows = await db().select().from(vendors)
    .where(or(
      ilike(vendors.legalName, pattern),
      ilike(vendors.displayName, pattern),
      ilike(vendors.gstin, pattern),
      ilike(vendors.pan, pattern),
    ))
    .limit(limit);
  return rows.map(rowToDoc);
}
