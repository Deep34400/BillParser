import { describe, it, expect, beforeEach } from 'vitest';
import { upsertVendorFromInvoice } from '../../src/vendor/vendorService.js';
import { devStore } from '../../src/shared/devStore.js';
import type { ParsedInvoiceData } from '../../src/shared/types.js';

beforeEach(() => {
  devStore.vendors.clear();
});

describe('upsertVendorFromInvoice', () => {
  it('creates a new vendor when none exists', async () => {
    const parsed: ParsedInvoiceData = {
      company_name: 'VIPUL MOTORS PVT. LTD.',
      gstin: '09AABCV0931B1ZS',
      pan: 'AABCV0931B',
      invoice_date: '25/06/2026',
    };

    const vendorId = await upsertVendorFromInvoice('bill-001', parsed);
    expect(vendorId).toBeTruthy();

    const vendor = devStore.vendors.get(vendorId!);
    expect(vendor).toBeTruthy();
    expect(vendor!.legal_name).toBe('VIPUL MOTORS PVT. LTD.');
    expect(vendor!.gstin).toBe('09AABCV0931B1ZS');
    expect(vendor!.pan).toBe('AABCV0931B');
    expect(vendor!.invoice_count).toBe(1);
  });

  it('matches existing vendor by GSTIN and increments count', async () => {
    const parsed: ParsedInvoiceData = {
      company_name: 'VIPUL MOTORS PVT. LTD.',
      gstin: '09AABCV0931B1ZS',
    };

    const id1 = await upsertVendorFromInvoice('bill-001', parsed);
    const id2 = await upsertVendorFromInvoice('bill-002', parsed);

    expect(id1).toBe(id2);
    const vendor = devStore.vendors.get(id1!);
    expect(vendor!.invoice_count).toBe(2);
  });

  it('matches existing vendor by PAN when GSTIN differs', async () => {
    const first: ParsedInvoiceData = {
      company_name: 'VIPUL MOTORS',
      gstin: '09AABCV0931B1ZS',
      pan: 'AABCV0931B',
    };
    const second: ParsedInvoiceData = {
      company_name: 'VIPUL MOTORS BRANCH 2',
      pan: 'AABCV0931B',
    };

    const id1 = await upsertVendorFromInvoice('bill-001', first);
    const id2 = await upsertVendorFromInvoice('bill-002', second);

    expect(id1).toBe(id2);
  });

  it('matches existing vendor by legal_name when no GSTIN/PAN', async () => {
    const first: ParsedInvoiceData = { company_name: 'Anysphere, Inc.' };
    const second: ParsedInvoiceData = { company_name: 'Anysphere, Inc.' };

    const id1 = await upsertVendorFromInvoice('bill-001', first);
    const id2 = await upsertVendorFromInvoice('bill-002', second);

    expect(id1).toBe(id2);
    expect(devStore.vendors.get(id1!)!.invoice_count).toBe(2);
  });

  it('returns null when parsed data has no vendor info', async () => {
    const vendorId = await upsertVendorFromInvoice('bill-001', {});
    expect(vendorId).toBeNull();
  });

  it('updates last_seen on second invoice', async () => {
    const parsed: ParsedInvoiceData = {
      company_name: 'Test Vendor',
      gstin: '07AABCK1234L1ZX',
    };

    await upsertVendorFromInvoice('bill-001', parsed);
    const v1 = devStore.vendors.values().next().value!;
    const firstSeen = v1.last_seen;

    await new Promise((r) => setTimeout(r, 10));
    await upsertVendorFromInvoice('bill-002', parsed);
    const v2 = devStore.vendors.values().next().value!;

    expect(v2.last_seen >= firstSeen).toBe(true);
    expect(v2.first_seen).toBe(v1.first_seen);
  });
});
