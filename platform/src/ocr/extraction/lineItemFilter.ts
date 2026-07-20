import type { LabourServiceLineItem } from '../parsing/types.js';

/** Table grouping rows on Toyota/Maruti invoices — not real labour line items. */
const LABOUR_SECTION_HEADER_RE =
  /\b(oil|parts|labour|labor|service|misc|other|sub[\s-]?total)\s+charges?\b/i;

export function isLabourSectionHeader(desc: string | null | undefined): boolean {
  const t = desc?.trim();
  if (!t) return false;
  return LABOUR_SECTION_HEADER_RE.test(t) || /^charges$/i.test(t);
}

function hasLabourIdentifiers(li: LabourServiceLineItem): boolean {
  return Boolean(li.labour_code?.trim()) || Boolean(li.hsn_sac_code?.trim());
}

/**
 * Drop table section headers and empty placeholder rows the LLM sometimes
 * puts in labour_service_line_items (e.g. Arpanna "Oil charges" with ₹0).
 */
export function filterLabourLineItems(items: LabourServiceLineItem[]): LabourServiceLineItem[] {
  return items.filter((li) => {
    const desc = li.labour_description?.trim() ?? '';
    if (isLabourSectionHeader(desc)) return false;

    const charges = li.labour_charges ?? 0;
    if (charges !== 0) return true;
    if (hasLabourIdentifiers(li)) return true;

    // Zero charge, no code/HSN — drop only when description is empty or a header.
    return desc.length > 0 && !isLabourSectionHeader(desc);
  });
}
