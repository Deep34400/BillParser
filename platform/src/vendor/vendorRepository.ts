/**
 * Vendor Repository — Sequelize CRUD for the `vendors` table.
 */
import { Op, literal } from 'sequelize';
import { Vendor } from './models/index.js';
import type { VendorDoc } from './vendorTypes.js';

function rowToDoc(row: Vendor): VendorDoc {
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

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function createVendor(vendor: VendorDoc): Promise<VendorDoc> {
  await Vendor.create({
    vendorId: vendor.vendor_id,
    legalName: vendor.legal_name,
    displayName: vendor.display_name,
    gstin: vendor.gstin,
    pan: vendor.pan,
    invoiceCount: vendor.invoice_count,
    firstSeen: new Date(vendor.first_seen),
    lastSeen: new Date(vendor.last_seen),
    parserName: vendor.parser_name,
    createdAt: new Date(vendor.created_at),
    updatedAt: new Date(vendor.updated_at),
  } as any);
  return vendor;
}

export async function getVendor(vendorId: string): Promise<VendorDoc | null> {
  const row = await Vendor.findByPk(vendorId);
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

  await Vendor.update(patch, { where: { vendorId } });
}

export async function listVendors(opts: { limit?: number; offset?: number } = {}): Promise<VendorDoc[]> {
  const rows = await Vendor.findAll({
    order: [['invoiceCount', 'DESC']],
    limit: opts.limit ?? 100,
    offset: opts.offset ?? 0,
  });
  return rows.map(rowToDoc);
}

// ─── Lookup helpers ─────────────────────────────────────────────────────────

export async function findByGstin(gstin: string): Promise<VendorDoc | null> {
  const row = await Vendor.findOne({ where: { gstin } });
  return row ? rowToDoc(row) : null;
}

export async function findByPan(pan: string): Promise<VendorDoc | null> {
  const row = await Vendor.findOne({ where: { pan } });
  return row ? rowToDoc(row) : null;
}

export async function findByLegalName(name: string): Promise<VendorDoc | null> {
  const row = await Vendor.findOne({
    where: literal(`lower("legal_name") = lower('${name.replace(/'/g, "''")}')`),
  });
  return row ? rowToDoc(row) : null;
}

export async function searchVendors(q: string, limit = 20): Promise<VendorDoc[]> {
  const pattern = `%${q}%`;
  const rows = await Vendor.findAll({
    where: {
      [Op.or]: [
        { legalName: { [Op.iLike]: pattern } },
        { displayName: { [Op.iLike]: pattern } },
        { gstin: { [Op.iLike]: pattern } },
        { pan: { [Op.iLike]: pattern } },
      ],
    },
    limit,
  });
  return rows.map(rowToDoc);
}
