/**
 * Central prompts — change ONLY here to improve OCR / structuring accuracy.
 * Flow: OCR (extraction provider) → markdown → structuring (LLM) → JSON below.
 */

export const OCR_PROMPT =
  'You are an OCR engine. Transcribe this Indian automotive service invoice to GitHub-flavored Markdown. ' +
  'CRITICAL: preserve the entire bill summary footer verbatim — each row with Parts and Labour column values:\n' +
  '- Sub Total Amount (parts total | labour total)\n' +
  '- Less Discount on Parts & Labour (parts discount | labour discount)\n' +
  '- CGST @ 9% (parts CGST amount | labour CGST amount)\n' +
  '- SGST @ 9% (parts SGST amount | labour SGST amount)\n' +
  '- Net Bill Amount (Rounded)\n' +
  'Also preserve every parts line item row (qty, rate, taxable amount, HSN, tax %) and labour rows (labour charges). ' +
  'Output only the transcription — no commentary, no code fences.';

export const OCR_HEADER_PROMPT =
  'You are an OCR engine. This image is the top/header section of an invoice. Transcribe it to ' +
  'plain Markdown, capturing company name, GSTIN, PAN, IRN, invoice number, invoice date/time, ' +
  'vehicle registration, chassis, odometer, and service details. ' +
  'Output only the transcription — no commentary, no code fences.';

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
  'You are an automotive/service invoice parser. Given OCR markdown of ONE invoice, return ONLY minified JSON matching this exact shape:\n' +
  SCHEMA_JSON_SKELETON +
  '\nRules:\n' +
  '- Return exactly ONE entry in output.entries.\n' +
  '- Use null for unknown fields. Numbers as JSON numbers with NO commas (1823.76 not 1,823.76).\n' +
  '- invoice_date as DD/MM/YYYY when printed that way; invoice_time as HH:MM:SS when present.\n' +
  '- Header fields when printed: irn, pan, gstin; service_details (last_service, service_type, ' +
  'next_service_due); vehicle_details (chassis_number, registration_number, mileage_odometer_reading).\n' +
  '- parts_line_items = physical parts/spares rows; labour_service_line_items = labour/service rows.\n' +
  '- LINE ITEMS ARE ALWAYS GROSS (the amount BEFORE any line discount). A per-line "Discount" column ' +
  'belongs ONLY in the footer "Less Discount" row — NEVER subtract it on the line item.\n' +
  '- Parts row: taxable_amount MUST equal quantity × rate (GROSS, before discount). Extract all three separately.\n' +
  '- Labour row: labour_charges = unit price × quantity (GROSS, before discount) — no quantity/rate fields.\n' +
  '  MG / Morris Garages "Repair Order" example — a row "Unit Price 1265.00 | Discount 126.50 | Taxable Amt 1138.50" ' +
  'means labour_charges = 1265.00 (the gross Unit Price), NOT 1138.50 (the post-discount Taxable Amt). The 126.50 goes to labour_discount.\n' +
  '- hsn_sac_code is a 4–8 digit HSN or SAC code (e.g. 998729), NEVER a tax percentage.\n' +
  '- tax_percentage is GST % (0–28) for that line only; null if not printed on the line.\n' +
  '- totals_and_tax_summary FOOTER (mandatory when printed): two columns Parts | Labour.\n' +
  '  parts_total/labour_total = GROSS before discount (first Sub Total row or charge-table col 1).\n' +
  '  NEVER use taxable-after-discount as subtotal. Charge table: | Parts | gross | discount | taxable | cgst | sgst |.\n' +
  '  parts_discount, labour_discount = "Less Discount" row (separate per column).\n' +
  '  parts_cgst_rate/labour_cgst_rate = CGST % from footer (e.g. 9). parts_cgst_amount/labour_cgst_amount = printed amounts (e.g. 161.26 and 77.04).\n' +
  '  parts_sgst_rate/labour_sgst_rate = SGST % from footer (e.g. 9). parts_sgst_amount/labour_sgst_amount = printed amounts.\n' +
  '  Line items may show tax_percentage 18 (total GST) — footer shows split CGST 9% + SGST 9% with separate amounts.\n' +
  '  grand_total_invoice = "Net Bill Amount (Rounded)" (e.g. 3124.00).\n' +
  '- NEVER calculate GST as subtotal × rate%. GST is on amount AFTER discount — copy printed footer amounts only.\n' +
  '- If footer shows CGST @ 9% with 161.26 (parts) and 77.04 (labour), use those exact numbers — NOT 9% of 2117.31.\n' +
  '- parts_discount and labour_discount are SEPARATE — never merge.\n' +
  '- Intra-state = CGST+SGST; inter-state = IGST. Match the invoice.\n' +
  '- confidence: 0..1 reflecting extraction certainty.\n' +
  '- No prose, no markdown fences, no comments — JSON only.';
