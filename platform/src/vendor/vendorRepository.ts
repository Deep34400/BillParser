/**
 * Vendor Repository — Firestore CRUD for the `vendors` collection.
 * Pure data-access layer. No business logic.
 */
import { env } from '../config/env.js';
import { db, col } from '../config/firebase.js';
import { devStore } from '../shared/devStore.js';
import type { VendorDoc } from './vendorTypes.js';

const COLLECTION = 'vendors';

function ref() { return db().collection(col(COLLECTION)); }

// ─── CRUD ───────────────────────────────────────────────────────────────────

export async function createVendor(vendor: VendorDoc): Promise<VendorDoc> {
  if (env.localDev) { devStore.vendors.set(vendor.vendor_id, vendor); return vendor; }
  await ref().doc(vendor.vendor_id).set(vendor);
  return vendor;
}

export async function getVendor(vendorId: string): Promise<VendorDoc | null> {
  if (env.localDev) return devStore.vendors.get(vendorId) ?? null;
  const snap = await ref().doc(vendorId).get();
  return snap.exists ? (snap.data() as VendorDoc) : null;
}

export async function updateVendor(vendorId: string, updates: Partial<VendorDoc>): Promise<void> {
  if (env.localDev) {
    const existing = devStore.vendors.get(vendorId);
    if (existing) devStore.vendors.set(vendorId, { ...existing, ...updates, updated_at: new Date().toISOString() });
    return;
  }
  await ref().doc(vendorId).update({ ...updates, updated_at: new Date().toISOString() });
}

export async function listVendors(opts: { limit?: number; offset?: number } = {}): Promise<VendorDoc[]> {
  if (env.localDev) {
    let rows = Array.from(devStore.vendors.values());
    rows.sort((a, b) => (b.invoice_count ?? 0) - (a.invoice_count ?? 0));
    if (opts.offset) rows = rows.slice(opts.offset);
    return rows.slice(0, opts.limit ?? 100);
  }
  let q: FirebaseFirestore.Query = ref().orderBy('invoice_count', 'desc');
  if (opts.offset) q = q.offset(opts.offset);
  q = q.limit(opts.limit ?? 100);
  const snap = await q.get();
  return snap.docs.map((d) => d.data() as VendorDoc);
}

// ─── Lookup helpers (for matching) ──────────────────────────────────────────

export async function findByGstin(gstin: string): Promise<VendorDoc | null> {
  if (env.localDev) {
    for (const v of devStore.vendors.values()) {
      if (v.gstin === gstin) return v;
    }
    return null;
  }
  const snap = await ref().where('gstin', '==', gstin).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as VendorDoc);
}

export async function findByPan(pan: string): Promise<VendorDoc | null> {
  if (env.localDev) {
    for (const v of devStore.vendors.values()) {
      if (v.pan === pan) return v;
    }
    return null;
  }
  const snap = await ref().where('pan', '==', pan).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as VendorDoc);
}

export async function findByLegalName(name: string): Promise<VendorDoc | null> {
  if (env.localDev) {
    const lower = name.toLowerCase();
    for (const v of devStore.vendors.values()) {
      if (v.legal_name?.toLowerCase() === lower) return v;
    }
    return null;
  }
  const snap = await ref().where('legal_name', '==', name).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as VendorDoc);
}

export async function searchVendors(q: string, limit = 20): Promise<VendorDoc[]> {
  const all = await listVendors({ limit: 1000 });
  const lower = q.toLowerCase();
  return all
    .filter((v) =>
      (v.legal_name?.toLowerCase().includes(lower)) ||
      (v.display_name?.toLowerCase().includes(lower)) ||
      (v.gstin?.toLowerCase().includes(lower)) ||
      (v.pan?.toLowerCase().includes(lower))
    )
    .slice(0, limit);
}
