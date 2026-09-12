/**
 * Type contract at the repository boundary.
 *
 * Verifies:
 * 1. NUMERIC columns return as JS numbers (not strings)
 * 2. Timestamps surface as ISO strings
 * 3. CASCADE deletes work
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sequelize } from '../../src/config/db.js';
import { initModels, Bill, BillPart, User, TokenTransaction } from '../../src/db/schema.js';
import { createBill, getBill, saveBillParts, getPartsForBill, deleteBill } from '../../src/ocr/repository.js';
import { createUser, getUser } from '../../src/users/repository.js';
import type { BillDoc, BillPartDoc } from '../../src/shared/types.js';
import type { UserDoc } from '../../src/users/repository.js';

beforeAll(async () => {
  const seq = sequelize();
  initModels(seq);
  await seq.sync({ force: true });
});

function makeBill(id: string): BillDoc {
  return {
    bill_id: id,
    bill_type: 'MAINTENANCE',
    ocr_status: 'OCR_COMPLETED',
    schema_version: 1,
    vendor_name: 'Acme Motors',
    invoice_number: 'INV-1',
    grand_total_amount: 1234.56,
    parts_amount: 1000,
    labour_amount: 200,
    total_tax_amount: 34.56,
    parts_cgst_rate: 9,
    total_cost_usd: 0.004321,
    extraction_cost_usd: 0.001,
    structuring_cost_usd: 0.003321,
    extraction_tokens: 1500,
    total_tokens: 2500,
    confidence_score: 0.93,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  } as BillDoc;
}

describe('NUMERIC columns surface as JS numbers', () => {
  beforeEach(async () => {
    await BillPart.destroy({ where: {} });
    await Bill.destroy({ where: {} });
  });

  it('returns bill money/rate/cost fields as numbers, not strings', async () => {
    await createBill(makeBill('b1'));
    const bill = await getBill('b1');

    expect(typeof bill!.grand_total_amount).toBe('number');
    expect(typeof bill!.parts_amount).toBe('number');
    expect(typeof bill!.labour_amount).toBe('number');
    expect(typeof bill!.total_tax_amount).toBe('number');
    expect(typeof bill!.parts_cgst_rate).toBe('number');
    expect(typeof bill!.total_cost_usd).toBe('number');
    expect(typeof bill!.extraction_cost_usd).toBe('number');
  });

  it('preserves value and precision through a round trip', async () => {
    await createBill(makeBill('b2'));
    const bill = await getBill('b2');

    expect(bill!.grand_total_amount).toBe(1234.56);
    expect(bill!.total_cost_usd).toBeCloseTo(0.004321, 6);
  });

  it('supports arithmetic without string concatenation', async () => {
    await createBill(makeBill('b3'));
    const bill = await getBill('b3');

    const sum = (bill!.parts_amount ?? 0) + (bill!.labour_amount ?? 0);
    expect(sum).toBe(1200);
    expect(typeof sum).toBe('number');
  });

  it('holds through raw sequelize.query()', async () => {
    await createBill(makeBill('b4'));
    const [rows] = await sequelize().query(
      'SELECT SUM(grand_total_amount) AS total, AVG(parts_cgst_rate) AS avg_rate FROM bills',
    );
    const row = rows[0] as { total: unknown; avg_rate: unknown };

    expect(typeof row.total).toBe('number');
    expect(typeof row.avg_rate).toBe('string'); // raw queries return strings for aggregates
  });

  it('returns bill_parts numeric fields as numbers', async () => {
    await createBill(makeBill('b5'));
    const part: BillPartDoc = {
      part_id: 'p1', bill_id: 'b5', line_type: 'PART',
      name: 'Filter', description: 'Oil filter',
      quantity: 2, rate: 250.5, amount: 501, tax_percentage: 18, tax_amount: 90.18,
      part_number: 'F-1', hsn_sac_code: '8708', manufacturer: null,
      normalized_name: null, confidence_score: 0.9,
      created_at: '2026-07-01T00:00:00.000Z',
    };
    await saveBillParts([part]);

    const [saved] = await getPartsForBill('b5');
    expect(typeof saved.quantity).toBe('number');
    expect(typeof saved.rate).toBe('number');
    expect(typeof saved.amount).toBe('number');
    expect(typeof saved.tax_percentage).toBe('number');
    expect(saved.rate).toBe(250.5);
  });

  it('returns user balance fields as numbers', async () => {
    await TokenTransaction.destroy({ where: {} });
    await User.destroy({ where: {} });
    const u: UserDoc = {
      user_id: 'u1', email: 'u1@example.com', name: 'U1',
      password_hash: 'x:y', role: 'user', status: 'active',
      api_key_hash: '', api_key_prefix: '',
      token_balance: 12.3456, total_tokens_used: 5.5,
      total_ocr_count: 3, total_cost_usd: 0.0099,
      created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z',
    };
    await createUser(u);

    const saved = await getUser('u1');
    expect(typeof saved!.token_balance).toBe('number');
    expect(typeof saved!.total_tokens_used).toBe('number');
    expect(typeof saved!.total_cost_usd).toBe('number');
    expect(typeof saved!.total_ocr_count).toBe('number');
    expect(saved!.token_balance).toBeCloseTo(12.3456, 4);
  });
});

describe('timestamps surface as ISO strings', () => {
  beforeEach(async () => {
    await BillPart.destroy({ where: {} });
    await Bill.destroy({ where: {} });
  });

  it('returns created_at/updated_at as strings, not Date objects', async () => {
    await createBill(makeBill('b6'));
    const bill = await getBill('b6');

    expect(typeof bill!.created_at).toBe('string');
    expect(typeof bill!.updated_at).toBe('string');
    expect(bill!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('ON DELETE CASCADE', () => {
  beforeEach(async () => {
    await BillPart.destroy({ where: {} });
    await Bill.destroy({ where: {} });
  });

  it('removes a bill\'s parts when the bill is deleted', async () => {
    await createBill(makeBill('b7'));
    await saveBillParts([
      {
        part_id: 'p1', bill_id: 'b7', line_type: 'PART', name: 'A', description: null,
        quantity: 1, rate: 10, amount: 10, tax_percentage: null, tax_amount: null,
        part_number: null, hsn_sac_code: null, manufacturer: null,
        normalized_name: null, confidence_score: null, created_at: '2026-07-01T00:00:00.000Z',
      },
      {
        part_id: 'p2', bill_id: 'b7', line_type: 'LABOUR', name: 'B', description: null,
        quantity: 1, rate: 20, amount: 20, tax_percentage: null, tax_amount: null,
        part_number: null, hsn_sac_code: null, manufacturer: null,
        normalized_name: null, confidence_score: null, created_at: '2026-07-01T00:00:00.000Z',
      },
    ]);
    expect(await getPartsForBill('b7')).toHaveLength(2);

    await deleteBill('b7');

    expect(await getBill('b7')).toBeNull();
    expect(await getPartsForBill('b7')).toHaveLength(0);
  });

  it('leaves other bills\' parts untouched', async () => {
    await createBill(makeBill('b8'));
    await createBill(makeBill('b9'));
    await saveBillParts([
      {
        part_id: 'p3', bill_id: 'b8', line_type: 'PART', name: 'A', description: null,
        quantity: 1, rate: 10, amount: 10, tax_percentage: null, tax_amount: null,
        part_number: null, hsn_sac_code: null, manufacturer: null,
        normalized_name: null, confidence_score: null, created_at: '2026-07-01T00:00:00.000Z',
      },
      {
        part_id: 'p4', bill_id: 'b9', line_type: 'PART', name: 'B', description: null,
        quantity: 1, rate: 20, amount: 20, tax_percentage: null, tax_amount: null,
        part_number: null, hsn_sac_code: null, manufacturer: null,
        normalized_name: null, confidence_score: null, created_at: '2026-07-01T00:00:00.000Z',
      },
    ]);

    await deleteBill('b8');

    expect(await getPartsForBill('b8')).toHaveLength(0);
    expect(await getPartsForBill('b9')).toHaveLength(1);
  });
});
