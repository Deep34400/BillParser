import { describe, expect, it } from 'vitest';
import { resolveVendorFromMarkdown } from '../../src/billing/vendorExtract.js';
import type { ParsedInvoiceData } from '../../src/parsing/types.js';

const ARPANNA_MARKDOWN = `
Arpanna Motors Private Ltd
Plot No. 12, Andheri, Mumbai
GSTIN/UIN : 27AADCA4487F1ZM
PAN : AADCA4487F

Tax Invoice

Details of Receiver (Billed To)
Name : CARRUM MOBILITY SOLUTIONS PVT LTD
Address : Mumbai
GSTIN/UIN : 27AALCC8489R1ZD

Invoice No. TXA26-01398
`.trim();

function baseParsed(overrides: Partial<ParsedInvoiceData> = {}): ParsedInvoiceData {
  return {
    company_name: null,
    gstin: null,
    pan: null,
    irn: null,
    invoice_number: null,
    invoice_date: null,
    invoice_time: null,
    parts_line_items: [],
    labour_service_line_items: [],
    confidence: 0.9,
    ...overrides,
  };
}

describe('resolveVendorFromMarkdown', () => {
  it('replaces buyer company_name and gstin with seller from invoice header', () => {
    const parsed = baseParsed({
      company_name: 'CARRUM MOBILITY SOLUTIONS PVT LTD',
      gstin: '27AALCC8489R1ZD',
    });

    const fixed = resolveVendorFromMarkdown(parsed, ARPANNA_MARKDOWN);

    expect(fixed.company_name).toBe('Arpanna Motors Private Ltd');
    expect(fixed.gstin).toBe('27AADCA4487F1ZM');
  });

  it('fixes wrong gstin even when company_name is missing', () => {
    const parsed = baseParsed({ gstin: '27AALCC8489R1ZD' });

    const fixed = resolveVendorFromMarkdown(parsed, ARPANNA_MARKDOWN);

    expect(fixed.gstin).toBe('27AADCA4487F1ZM');
    expect(fixed.company_name).toBe('Arpanna Motors Private Ltd');
  });

  it('leaves correct seller fields unchanged', () => {
    const parsed = baseParsed({
      company_name: 'Arpanna Motors Private Ltd',
      gstin: '27AADCA4487F1ZM',
    });

    const fixed = resolveVendorFromMarkdown(parsed, ARPANNA_MARKDOWN);

    expect(fixed.company_name).toBe('Arpanna Motors Private Ltd');
    expect(fixed.gstin).toBe('27AADCA4487F1ZM');
  });

  it('returns parsed unchanged when markdown is absent', () => {
    const parsed = baseParsed({
      company_name: 'CARRUM MOBILITY SOLUTIONS PVT LTD',
      gstin: '27AALCC8489R1ZD',
    });

    expect(resolveVendorFromMarkdown(parsed)).toEqual(parsed);
    expect(resolveVendorFromMarkdown(parsed, '')).toEqual(parsed);
  });
});

// Real Maruti/Varun "Job Card Retail" layout: BUYER at TOP (Customer Name & Address,
// "Cust GSTIN/UIN"), real SELLER at BOTTOM ("For VARUN MOTORS PVT LTD", "Dealer GSTIN").
const VARUN_MARKDOWN = `
ORIGINAL FOR RECIPIENT/DUPLICATE FOR TRANSPORTER/TRIPLICATE FOR SUPPLIER

# **Job Card Retail - Tax Invoice**

**IRN :** 29c1e0c10e9bc14a6a89370254e7dc1b05252f526b72ca1410d52a369bb32965

Customer Name & Address : ID : 2460025893

# **CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED**

7TH FLOOR PARAS DOWNTOWN, CENTER GOLF COURSE, ROAD SECTOR 53
HYDERABAD
Pin:500037
State & Code : 36-TELANGANA
Cust GSTIN/UIN : 36AALCC8489R1ZE
PAN : AALCC8489R
Invoice No. : 9/BR/25007433
Date : 26/08/2025 09:35:01
Reg.No. : TG07T5587

| Srl. | Part Number | Description | HSN/SAC | Tax | Qty. | Rate | Taxable Amount |
| 1 | 08316M1005A | NUT | 73181600 | 18% | 2.000 | 0.84 | 1.68 |

**For VARUN MOTORS PVT LTD**

Authorised Signatory

Dealer GSTIN : 36AABCV2471Q1ZT

**Net Bill Amount (Rounded) : 36,551.00**
`.trim();

describe('resolveVendorFromMarkdown — buyer-at-top / seller-at-bottom (Varun/Maruti)', () => {
  it('picks Dealer GSTIN and "For <company>" seller, not the Cust GSTIN buyer', () => {
    const parsed = baseParsed({
      company_name: 'CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED',
      gstin: '36AALCC8489R1ZE',
      pan: 'AALCC8489R',
    });

    const fixed = resolveVendorFromMarkdown(parsed, VARUN_MARKDOWN);

    expect(fixed.gstin).toBe('36AABCV2471Q1ZT');
    expect(fixed.company_name).toBe('VARUN MOTORS PVT LTD');
    expect(fixed.pan).toBe('AABCV2471Q');
  });

  it('fixes vendor even when LLM used the invoice title as company_name', () => {
    const parsed = baseParsed({
      company_name: 'Job Card Retail - Tax Invoice',
      gstin: '36AALCC8489R1ZE',
    });

    const fixed = resolveVendorFromMarkdown(parsed, VARUN_MARKDOWN);

    expect(fixed.gstin).toBe('36AABCV2471Q1ZT');
    expect(fixed.company_name).toBe('VARUN MOTORS PVT LTD');
  });

  it('blocklists buyer by PAN across GST state codes', () => {
    // A different Carrum GSTIN (Maharashtra) shares the same PAN root
    const parsed = baseParsed({
      company_name: 'CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED',
      gstin: '27AALCC8489R1ZD',
    });

    const fixed = resolveVendorFromMarkdown(parsed, VARUN_MARKDOWN);

    expect(fixed.gstin).toBe('36AABCV2471Q1ZT');
  });
});

// Handwritten Toyota/Maruti workshop bill with NO GSTIN/PAN. Real workshop is "AJAY PAL"
// on the letterhead; the buyer "CARRUM MOBILITY" is written in the body after "M/s".
const HANDWRITTEN_MARKDOWN = `
BILL/CASH MEMO
AJAY PAL
Mechanical Electrical, Denting & Painting, Car A/C Wheel Alignments
KISHAN GANJ MAIN CAR MARKET, NEAR CANARA BANK

S.No. B 005
M/s Carrum Mobility Solution Pvt LTD
HR55 AW 5187

| S.No. | PARTICULARS | QTY. | RATE | AMOUNT Rs. P. |
| 1 | Left fender Denting | | | 300 |
| 2 | Left fender Panty | | | 1200 |
`.trim();

describe('resolveVendorFromMarkdown — handwritten workshop (no GSTIN/PAN)', () => {
  it('rejects a table-header string picked as company_name', () => {
    const parsed = baseParsed({
      company_name: 'S.No. PARTICULARS QTY. RATE AMOUNT Rs. P.',
      gstin: null,
    });

    const fixed = resolveVendorFromMarkdown(parsed, HANDWRITTEN_MARKDOWN);

    expect(fixed.company_name).not.toMatch(/PARTICULARS/i);
  });

  it('does not adopt the buyer written after "M/s"', () => {
    const parsed = baseParsed({
      company_name: 'Carrum Mobility Solution Pvt LTD',
      gstin: null,
    });

    const fixed = resolveVendorFromMarkdown(parsed, HANDWRITTEN_MARKDOWN);

    expect(fixed.company_name).not.toMatch(/carrum/i);
  });
});

// Everything crammed into one table cell (real Mistral OCR of the AJAY PAL memo). The shop
// name only reliably appears at the bottom as "For AJAY PAL" next to "Customer Signature".
const AJAY_PAL_BLOB = `
|  BILL/CASH MEMO AJAY PAL Mechanical Electrical, Denting & Painting, Car A/C Wheel Alignments & Wheel Balancing Axcel Repair Indian & Imported Car KISHAN GARII MAIN CAR MARKET, NEAR CANARA BANK VSANT KUNJ, N.D.-78 Ph.: 9871829747 7360913769 MARUTI S.No. B 001 M/s Carrum Mobility Solution Pvt LTD HR55 AW 8692 Date 01/05/96  |   |   |   |   |
| --- | --- | --- | --- | --- |
|  S.No. | PARTICULARS | QTY. | RATE | AMOUNT Rs. P.  |
|  1 | Rights Ren Door Denty |  |  | 300 -  |
|  2 | R.H Door Pantry Ren |  |  | 1900 -  |
|   | Received the above goods in good order & condition |  | TOTAL | 1500  |
|  Customer Signature For AJAY PAL Ay  |   |   |   |   |
`.trim();

describe('resolveVendorFromMarkdown — "For <name>" next to Customer Signature', () => {
  it('extracts AJAY PAL from the signatory line, dropping the header blob', () => {
    const parsed = baseParsed({
      company_name:
        'BILL/CASH MEMO AJAY PAL Mechanical Electrical, Denting & Painting, Car A/C Wheel Alignments',
      gstin: null,
    });

    const fixed = resolveVendorFromMarkdown(parsed, AJAY_PAL_BLOB);

    expect(fixed.company_name).toBe('AJAY PAL');
  });
});

// Tally e-invoice: TYRESNMORE seller, CARRUM in Consignee + Buyer (Bill to).
// OCR sometimes puts Buyer block BEFORE the seller letterhead — buyer scan must not swallow seller GSTIN.
const TYRESNMORE_MARKDOWN = `
# Tax Invoice
(ORIGINAL FOR RECIPIENT)
**TYRESNMORE ONLINE PRIVATE LIMITED**
GSTIN/UIN: 29AAFCT0178A1ZJ

Consignee (Ship to)
**CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED**
GSTIN/UIN : 29AALCC8489R1Z9

Buyer (Bill to)
**CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED**
GSTIN/UIN : 29AALCC8489R1Z9

for TYRESNMORE ONLINE PRIVATE LIMITED
Authorised Signatory
Company's PAN : AAFCT0178A
`.trim();

const TYRESNMORE_BAD_ORDER = `
# Tax Invoice
Buyer (Bill to)
**CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED**
GSTIN/UIN : 29AALCC8489R1Z9

Consignee (Ship to)
**CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED**
GSTIN/UIN : 29AALCC8489R1Z9

**TYRESNMORE ONLINE PRIVATE LIMITED**
GSTIN/UIN: 29AAFCT0178A1ZJ

for TYRESNMORE ONLINE PRIVATE LIMITED
Authorised Signatory
Company's PAN : AAFCT0178A
`.trim();

describe('resolveVendorFromMarkdown — Tally e-invoice (TyresNMore / Carrum)', () => {
  it('picks TYRESNMORE seller GSTIN, not Carrum Consignee/Buyer', () => {
    const parsed = baseParsed({
      company_name: 'CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED',
      gstin: '29AALCC8489R1Z9',
      pan: 'AALCC8489R',
    });

    const fixed = resolveVendorFromMarkdown(parsed, TYRESNMORE_MARKDOWN);

    expect(fixed.company_name).toBe('TYRESNMORE ONLINE PRIVATE LIMITED');
    expect(fixed.gstin).toBe('29AAFCT0178A1ZJ');
    expect(fixed.pan).toBe('AAFCT0178A');
  });

  it('still picks TYRESNMORE when OCR puts Buyer block before seller letterhead', () => {
    const parsed = baseParsed({
      company_name: 'CARRUM MOBILITY SOLUTIONS PRIVATE LIMITED',
      gstin: '29AALCC8489R1Z9',
      pan: 'AALCC8489R',
    });

    const fixed = resolveVendorFromMarkdown(parsed, TYRESNMORE_BAD_ORDER);

    expect(fixed.company_name).toBe('TYRESNMORE ONLINE PRIVATE LIMITED');
    expect(fixed.gstin).toBe('29AAFCT0178A1ZJ');
    expect(fixed.pan).toBe('AAFCT0178A');
  });
});

// SAI SERVICE — "Customer Name & Address" buyer at top, "Dealer GSTIN" + "For SAI SERVICE" at bottom.
const SAI_SERVICE_MARKDOWN = `
ORIGINAL FOR RECIPIENT/DUPLICATE FOR TRANSPORTER/TRIPLICATE FOR SUPPLIER

# Job Card Retail - Tax Invoice

Customer Name & Address : ID : 2563828506

# CARRUMMOBILITY SOLUTIONS PRIVATELIMITED

Flat No-504,Anurag Towers, 100 Feet RD,Siddivinayak Nagar,
HYDERABAD
Pin:500081
State & Code : 36-TELANGANA
Cust GSTIN/UIN :36AALCC8489R1ZE
PAN : AALCC8489R

Invoice No. : 15/BR/25002444
Date : 09/10/2025 14:27:50
Reg.No. : TG07V4660

| Srl. | Part Number | Description | HSN/SAC | Tax | Qty. | Rate | Taxable Amount |
| 1 | 09168M14012 | GASKET | 84841090 | 18% | 1.000 | 9.32 | 9.32 |

For SAI SERVICE PRIVATE LIMITED

Authorised Signatory

Dealer GSTIN : 36AABCS4998M1ZK
`.trim();

describe('resolveVendorFromMarkdown — SAI SERVICE (Dealer GSTIN at bottom)', () => {
  it('picks SAI SERVICE and Dealer GSTIN, not customer CARRUM', () => {
    const parsed = baseParsed({
      company_name: 'CARRUMMOBILITY SOLUTIONS PRIVATELIMITED',
      gstin: '36AALCC8489R1ZE',
      pan: 'AALCC8489R',
    });

    const fixed = resolveVendorFromMarkdown(parsed, SAI_SERVICE_MARKDOWN);

    expect(fixed.company_name).toBe('SAI SERVICE PRIVATE LIMITED');
    expect(fixed.gstin).toBe('36AABCS4998M1ZK');
    expect(fixed.pan).toBe('AABCS4998M');
  });
});
