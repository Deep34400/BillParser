/**
 * Central prompts — change ONLY here to improve OCR / structuring accuracy.
 * Flow: OCR (extraction provider) → markdown → structuring (LLM) → JSON below.
 *
 * IMPORTANT: Keep prompts MINIMAL. All post-processing (vendor vs buyer, dates,
 * GST footer, discount, Tally O-CGST, handwritten bills) is handled in CODE:
 *   billing/vendorExtract.ts  — seller/buyer detection + correction
 *   billing/dateExtract.ts    — date normalization + fallback
 *   billing/footerExtract.ts  — GST/discount/deductible from markdown
 *   billing/normalize.ts      — line-item enrichment pipeline
 *   billing/reviewFlags.ts    — human-review warnings
 *   parsing/validate.ts       — structural validation
 *
 * Adding new invoice formats? Fix in CODE (with tests), not here.
 */

export const OCR_PROMPT =
  'You are an OCR engine. Transcribe this invoice/bill to GitHub-flavored Markdown. ' +
  'Preserve ALL text verbatim — letterhead, addresses, tax IDs (GSTIN/VAT/ABN/EIN), line-item tables, ' +
  'and the bill summary footer (Sub Total, Discount, Tax, Total). ' +
  'Keep section labels ("Bill To", "Ship To", "From", etc.) as-is. ' +
  'Output only the transcription — no commentary, no code fences.';

export const OCR_HEADER_PROMPT =
  'You are an OCR engine. This image is the top/header section of an invoice. Transcribe it to ' +
  'plain Markdown. Capture company names, tax IDs (GSTIN/PAN/IRN/VAT/ABN/EIN), invoice number, date/time, ' +
  'and any vehicle/service/subscription details. ' +
  'Keep section labels intact. Output only the transcription — no commentary, no code fences.';

/** Minified skeleton — smaller/faster for structuring prompts. */
export const SCHEMA_JSON_SKELETON =
  '{"output":{"entries":[{"parsed_data":{"irn":null,"pan":null,"gstin":null,"company_name":null,' +
  '"invoice_number":null,"invoice_date":null,"invoice_time":null,' +
  '"service_details":{"last_service":null,"service_type":null,"next_service_due":null},' +
  '"vehicle_details":{"chassis_number":null,"registration_number":null,"mileage_odometer_reading":null},' +
  '"parts_line_items":[{"item_name_description":null,"part_number_item_code":null,' +
  '"hsn_sac_code":null,"quantity":null,"rate":null,"taxable_amount":null,"tax_percentage":null}],' +
  '"labour_service_line_items":[{"labour_description":null,"labour_code":null,"hsn_sac_code":null,' +
  '"labour_charges":null,"tax_percentage":null}],"totals_and_tax_summary":{"parts_total":null,' +
  '"labour_total":null,"parts_discount":null,"labour_discount":null,"parts_cgst_rate":null,' +
  '"parts_sgst_rate":null,"parts_igst_rate":null,"parts_cgst_amount":null,"parts_sgst_amount":null,' +
  '"parts_igst_amount":null,"labour_cgst_rate":null,"labour_sgst_rate":null,"labour_igst_rate":null,' +
  '"labour_cgst_amount":null,"labour_sgst_amount":null,"labour_igst_amount":null,' +
  '"sub_total_calculated":null,"grand_total_invoice":null,"deductibles":null,"salvage":null},' +
  '"confidence":0.9}}]}}';

/** JSON shape description — kept in sync with schema/types.ts */
export const SCHEMA_JSON_EXAMPLE = `{
  "output": {
    "entries": [{
      "id": "<uuid or null>",
      "parsed_data": {
        "irn": null,
        "pan": null,
        "gstin": null,
        "company_name": null,
        "invoice_date": "DD/MM/YYYY",
        "invoice_time": "HH:MM:SS",
        "invoice_number": null,
        "service_details": { "last_service": null, "service_type": null, "next_service_due": null },
        "vehicle_details": { "chassis_number": null, "registration_number": null, "mileage_odometer_reading": null },
        "parts_line_items": [{
          "rate": null, "quantity": null, "hsn_sac_code": null, "tax_percentage": null,
          "taxable_amount": null, "item_name_description": null, "part_number_item_code": null
        }],
        "labour_service_line_items": [{
          "labour_code": null, "hsn_sac_code": null, "labour_charges": null,
          "tax_percentage": null, "labour_description": null
        }],
        "totals_and_tax_summary": {
          "parts_total": null, "labour_total": null, "parts_discount": null, "labour_discount": null,
          "parts_cgst_rate": null, "parts_igst_rate": null, "parts_sgst_rate": null,
          "labour_cgst_rate": null, "labour_igst_rate": null, "labour_sgst_rate": null,
          "parts_cgst_amount": null, "parts_igst_amount": null, "parts_sgst_amount": null,
          "labour_cgst_amount": null, "labour_igst_amount": null, "labour_sgst_amount": null,
          "sub_total_calculated": null, "grand_total_invoice": null,
          "parts_special_discount": null, "labour_special_discount": null,
          "deductibles": null, "salvage": null
        },
        "confidence": 0.0
      }
    }]
  }
}`;

export const STRUCTURING_PROMPT =
  'You are an invoice parser. Given OCR markdown (or a document image) of ONE invoice, return ONLY minified JSON matching this exact shape:\n' +
  SCHEMA_JSON_SKELETON +
  '\nRules:\n' +
  '- Return exactly ONE entry in output.entries.\n' +
  '- Use null for unknown fields. Numbers as JSON numbers with NO commas (1823.76 not 1,823.76).\n' +
  '- invoice_date as DD/MM/YYYY; invoice_time as HH:MM:SS. If combined, split them.\n' +
  '- company_name = the business that ISSUED the invoice (seller/vendor/service provider). gstin and pan = seller\'s.\n' +
  '  Never use the page title alone ("Invoice", "Tax Invoice", "Receipt").\n' +
  '  For SaaS/Stripe-style bills: use the legal entity (e.g. "Anysphere, Inc.") or the From-section brand ("Cursor").\n' +
  '  Bill To / customer / ship-to is NOT company_name. US EIN / Tax ID → pan when no GSTIN.\n' +
  '- invoice_number: Invoice No. / Bill No. / Tax Invoice No. On proforma/job-card bills with no invoice number, use Job Card No.\n' +
  '- pan: seller PAN when printed; if only GSTIN is printed you may still set pan from the GSTIN middle 10 chars.\n' +
  '- parts_line_items = physical goods/products/parts; labour_service_line_items = services, subscriptions, labour.\n' +
  '  For SaaS/subscription invoices: put the plan/line items in labour_service_line_items.\n' +
  '- Line items are GROSS (amount BEFORE any discount). taxable_amount = quantity × rate.\n' +
  '- labour_charges = gross charge (before discount).\n' +
  '- hsn_sac_code = HSN/SAC code if printed. Do NOT put tax percentages here.\n' +
  '- tax_percentage = tax % for that line (GST/VAT/Sales Tax); null if not printed.\n' +
  '- totals_and_tax_summary: copy printed footer values.\n' +
  '  For Indian GST invoices: split into Parts and Labour columns (CGST/SGST intra-state, IGST inter-state).\n' +
  '  For non-GST invoices: put all tax in the labour_ fields (labour_igst_rate/amount for single-rate tax).\n' +
  '  grand_total_invoice = final total amount due.\n' +
  '- confidence: 0..1 reflecting extraction certainty.\n' +
  '- No prose, no markdown fences, no comments — JSON only.';
