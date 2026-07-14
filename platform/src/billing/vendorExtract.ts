import type { ParsedInvoiceData } from '../parsing/types.js';
import { env } from '../config/env.js';

/** Indian GSTIN — 15 chars (chars 3–12 = PAN). */
const GSTIN_RE = /\b(\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9])\b/gi;
const PAN_RE = /\b([A-Z]{5}\d{4}[A-Z])\b/;

/** Section labels that introduce the BUYER / customer / receiver block. */
const BUYER_SECTION_LABELS = [
  /details?\s+of\s+receiver/i,
  /billed?\s+to/i,
  /bill\s+to/i,
  /ship(?:ped)?\s+to/i,
  /consignee/i,
  /buyer(?:\s+details?)?/i,
  /customer\s+name/i,
  /customer\s+details?/i,
  /receiver\s*\(/i,
  /^m\/s\b/i,
];

/** Column headers of the line-item table — never a company name. */
const TABLE_HEADER_TOKENS = [
  /\bs\.?\s*no\.?\b/i,
  /\bsrl?\.?\b/i,
  /\bparticulars?\b/i,
  /\bdescription\b/i,
  /\bqty\.?\b|\bquantity\b/i,
  /\brate\b/i,
  /\bamount\b/i,
  /\bhsn\b|\bsac\b/i,
  /\btaxable\b/i,
  /\bpart\s*(?:no|number)\b/i,
];

/**
 * True when a string is really a line-item table header (e.g.
 * "S.No. PARTICULARS QTY. RATE AMOUNT Rs. P.") rather than a company name.
 */
export function looksLikeTableHeader(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  const hits = TABLE_HEADER_TOKENS.filter((re) => re.test(t)).length;
  return hits >= 2;
}

/** Max lines scanned per buyer section for GSTIN/name — keep small so a buyer block at the
 *  top of a Tally OCR (Buyer before Seller letterhead) cannot swallow the seller GSTIN. */
const BUYER_BLOCK_LINES = 6;

/** Footer labels for the ISSUER's PAN (Tally / e-invoice). */
const COMPANY_PAN_RE = /Company'?s?\s*PAN\s*[:\-*]?\s*\**([A-Z]{5}\d{4}[A-Z])\b/i;
const SELLER_KW = /\b(dealer|seller|supplier|issued\s*by)\b/i;
/** Keywords that mark a GSTIN line as the BUYER/customer/receiver. */
const BUYER_KW =
  /\b(cust|customer|buyer|receiver|consignee|party|billed?\s*to|bill\s*to|purchaser)\b/i;

const JUNK_HEADER_RE =
  /^(tax\s+invoice|original|duplicate|triplicate|cash\s+memo|job\s*card|retail|invoice\s+no|phone|email|tel|fax|www\.|http|gstin|pan\b|irn\b|udyam|cin\b|msme|fssai|state\s+code|place\s+of\s+supply|customer\s+name)/i;

const ADDRESS_LINE_RE =
  /^(plot|shop|flat|floor|building|road|street|near|opp|opposite|at\s|pin\b|pin:|dist|sector|hyderabad|mumbai|delhi|bangalore|bengaluru|pune|navi|chennai|kolkata)/i;

const COMPANY_NAME_HINT_RE =
  /\b(pvt|ltd|limited|motors|motor|garage|automobiles?|automotive|workshop|enterprises?|agency|agencies|corp|inc|llp|company|co\.|services?|autozone|toyota|honda|maruti|hyundai|tata|nexa)\b/i;

/** "For <COMPANY>" — allow up to 6 words for long names like TYRESNMORE ONLINE PRIVATE LIMITED. */
const FOR_INLINE_RE = /\b[Ff][Oo][Rr]\s+([A-Z][A-Z0-9&.]+(?:\s+[A-Z][A-Z0-9&.]+){0,5})/g;
const SIGNATORY_RE = /authoris(?:e|ed|ing)?\s*signatory|authorized\s*signatory|signatory|signature/i;

/** Words that follow "For" on invoice-copy notices — never a seller name. */
const FOR_STOPWORDS = new Set([
  'RECIPIENT', 'TRANSPORTER', 'SUPPLIER', 'CONSIGNEE', 'ORIGINAL', 'DUPLICATE', 'TRIPLICATE',
  'OFFICE', 'CUSTOMER', 'PAYMENT', 'DETAILS', 'THE', 'YOUR', 'OUR', 'ANY', 'ALL', 'GST', 'PAN',
  'RS', 'INR', 'RECEIVER', 'BUYER', 'ACCOUNT', 'ACCOUNTS', 'CASH', 'CREDIT',
]);

interface Party {
  name: string | null;
  gstin: string | null;
  pan: string | null;
}

interface Parties {
  seller: Party;
  buyerGstins: Set<string>;
  buyerPans: Set<string>;
  buyerNames: string[];
  /** True when seller GSTIN/name came from an explicit label (authoritative). */
  sellerConfident: boolean;
}

function clean(line: string): string {
  return line.replace(/[#*`>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeName(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function namesSimilar(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length > nb.length ? na : nb;
  if (shorter.length >= 8 && longer.includes(shorter)) return true;
  return false;
}

function isJunkHeaderLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length < 3) return true;
  if (JUNK_HEADER_RE.test(t)) return true;
  if (/^\d{2}[A-Z]{5}\d{4}/.test(t)) return true;
  if (/^[\d\s\-/:.]+$/.test(t)) return true;
  return false;
}

function looksLikeCompany(name: string): boolean {
  if (COMPANY_NAME_HINT_RE.test(name)) return true;
  const words = name.trim().split(/\s+/);
  const capsWords = words.filter((w) => /^[A-Z][A-Z.&-]*$/.test(w));
  return capsWords.length >= 2;
}

function panFromGstin(gstin: string | null): string | null {
  if (!gstin || gstin.length < 12) return null;
  return gstin.slice(2, 12).toUpperCase();
}

/** Classify a GSTIN-bearing line as seller/buyer/unknown by its inline label. */
function classifyGstinLine(line: string): 'seller' | 'buyer' | 'unknown' {
  if (SELLER_KW.test(line)) return 'seller';
  if (BUYER_KW.test(line)) return 'buyer';
  return 'unknown';
}

/** Find the seller name from a "For <COMPANY>" mention, preferring one next to a signatory. */
function findForSignatoryName(rawLines: string[]): string | null {
  const text = rawLines.map(clean).join('\n');
  const candidates: { name: string; nearSignatory: boolean }[] = [];
  for (const m of text.matchAll(FOR_INLINE_RE)) {
    const name = m[1].trim().replace(/[.,&\s]+$/, '').trim();
    if (name.length < 3) continue;
    const firstWord = name.split(/\s+/)[0].toUpperCase();
    if (FOR_STOPWORDS.has(firstWord)) continue;
    if (looksLikeTableHeader(name) || isJunkHeaderLine(name)) continue;
    const idx = m.index ?? 0;
    const ctx = text.slice(Math.max(0, idx - 45), idx + m[0].length + 45);
    candidates.push({ name, nearSignatory: SIGNATORY_RE.test(ctx) });
  }
  return candidates.find((c) => c.nearSignatory)?.name ?? candidates[0]?.name ?? null;
}

/** A vendor name that is clearly a document blob / boilerplate, not a real company name. */
export function isJunkVendorName(name: string | null | undefined): boolean {
  const t = name?.trim();
  if (!t) return false;
  if (looksLikeTableHeader(t)) return true;
  if (/bill\s*\/?\s*cash\s*memo|tax\s*invoice|cash\s*memo|estimate|quotation/i.test(t)) return true;
  if (t.length > 70) return true;
  if (t.split(/\s+/).length > 9) return true;
  return false;
}

function extractBuyerName(rawLines: string[], start: number): string | null {
  const block = rawLines.slice(start, start + BUYER_BLOCK_LINES).map(clean).filter(Boolean);
  for (const line of block) {
    const m = line.match(/(?:name\s*:?\s*|customer\s*:?\s*)(.+)/i);
    if (m?.[1]?.trim() && looksLikeCompany(m[1].trim())) return m[1].trim();
  }
  for (let i = 1; i < block.length; i++) {
    const line = block[i];
    if (!line || isJunkHeaderLine(line)) continue;
    if (GSTIN_RE.test(line)) break;
    if (/^(address|gstin|pan|state|pin|phone|email|mobile|id\b)/i.test(line)) continue;
    if (line.length >= 4) return line;
  }
  return null;
}

function extractParties(markdown: string): Parties {
  const rawLines = markdown.split(/\r?\n/);
  const lines = rawLines.map(clean);

  const buyerStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (BUYER_SECTION_LABELS.some((pat) => pat.test(lines[i]))) buyerStarts.push(i);
  }
  const firstBuyerIdx = buyerStarts.length ? Math.min(...buyerStarts) : lines.length;

  const buyerGstins = new Set<string>();
  const buyerPans = new Set<string>();
  const buyerNames: string[] = [];

  // Tally footer "Company's PAN" identifies the issuer — never treat that GSTIN as buyer.
  const companyPanM = markdown.match(COMPANY_PAN_RE);
  const issuerPan = companyPanM?.[1]?.toUpperCase() ?? null;

  for (const start of buyerStarts) {
    const blockLines = lines.slice(start, start + BUYER_BLOCK_LINES);
    for (const bl of blockLines) {
      for (const m of bl.matchAll(GSTIN_RE)) {
        const g = m[1].toUpperCase();
        if (issuerPan && panFromGstin(g) === issuerPan) continue;
        buyerGstins.add(g);
      }
    }
    const name = extractBuyerName(rawLines, start);
    if (name) buyerNames.push(name);
  }

  const gstinHits: { gstin: string; line: number; cls: 'seller' | 'buyer' | 'unknown' }[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(GSTIN_RE)) {
      let cls = classifyGstinLine(lines[i]);
      if (cls === 'unknown' && buyerGstins.has(m[1].toUpperCase())) cls = 'buyer';
      gstinHits.push({ gstin: m[1].toUpperCase(), line: i, cls });
    }
  }
  for (const hit of gstinHits) if (hit.cls === 'buyer') buyerGstins.add(hit.gstin);

  const labeledSeller = gstinHits.find((h) => h.cls === 'seller');
  const panMatchedSeller = issuerPan
    ? gstinHits.find((h) => panFromGstin(h.gstin) === issuerPan && !buyerGstins.has(h.gstin))
    : null;
  const positionalSeller = gstinHits.find(
    (h) => h.cls !== 'buyer' && !buyerGstins.has(h.gstin) && h.line < firstBuyerIdx,
  );
  const anySeller = gstinHits.find((h) => h.cls !== 'buyer' && !buyerGstins.has(h.gstin));
  const sellerGstinHit = labeledSeller ?? panMatchedSeller ?? positionalSeller ?? anySeller ?? null;
  const sellerGstin = sellerGstinHit?.gstin ?? null;

  // Buyer PAN: any PAN inside a buyer section — used to blocklist across state codes.
  for (const start of buyerStarts) {
    const blockText = lines.slice(start, start + BUYER_BLOCK_LINES).join('\n');
    const pm = blockText.match(/\bPAN\s*[:\-/]?\s*([A-Z]{5}\d{4}[A-Z])/i);
    if (pm?.[1]) buyerPans.add(pm[1].toUpperCase());
  }
  for (const g of buyerGstins) {
    const p = panFromGstin(g);
    if (p) buyerPans.add(p);
  }

  // Seller name: 1) "For <company>" near signatory, 2) line adjacent to seller GSTIN,
  // 3) positional header name (before buyer section), excluding buyer names.
  const forName = findForSignatoryName(rawLines);
  let sellerName: string | null = forName;
  if (!sellerName && sellerGstinHit) {
    const idx = sellerGstinHit.line;
    for (let j = idx - 1; j >= Math.max(0, idx - 3); j--) {
      const c = lines[j];
      if (c && !isJunkHeaderLine(c) && looksLikeCompany(c)) { sellerName = c; break; }
    }
  }
  if (!sellerName) {
    const headerLines = lines
      .slice(0, firstBuyerIdx)
      .filter((l) => !isJunkHeaderLine(l) && !looksLikeTableHeader(l));
    sellerName =
      headerLines.find((l) => looksLikeCompany(l) && !ADDRESS_LINE_RE.test(l)) ??
      headerLines.find((l) => !ADDRESS_LINE_RE.test(l) && l.length >= 4) ??
      null;
  }
  // Never accept a table header as the seller name.
  if (sellerName && looksLikeTableHeader(sellerName)) sellerName = null;

  const sellerPan =
    issuerPan ??
    (sellerGstin ? panFromGstin(sellerGstin) : null) ??
    null;

  const sellerConfident = labeledSeller != null || forName != null || panMatchedSeller != null;

  return {
    seller: { name: sellerName, gstin: sellerGstin, pan: sellerPan },
    buyerGstins,
    buyerPans,
    buyerNames,
    sellerConfident,
  };
}

function isBuyerGstin(gstin: string, p: Parties): boolean {
  const upper = gstin.toUpperCase();
  if (p.buyerGstins.has(upper)) return true;
  if (env.buyerGstinBlocklist.includes(upper)) return true;
  const pan = panFromGstin(upper);
  if (pan && p.buyerPans.has(pan)) return true;
  return false;
}

function isBuyerCompany(name: string | null | undefined, p: Parties): boolean {
  if (!name?.trim()) return false;
  return p.buyerNames.some((b) => namesSimilar(name, b));
}

/**
 * Correct vendor fields when the LLM picks the buyer (customer / Bill To / Receiver)
 * instead of the issuer workshop/dealer. Handles both layouts:
 *   - seller at top, buyer under "Bill To" / "Details of Receiver"
 *   - buyer at top ("Customer Name & Address"), seller at bottom ("For <co>", "Dealer GSTIN")
 */
export function resolveVendorFromMarkdown(
  parsed: ParsedInvoiceData,
  markdown?: string,
): ParsedInvoiceData {
  if (!markdown?.trim()) return parsed;

  const parties = extractParties(markdown);
  const { seller } = parties;

  const parsedGstin = parsed.gstin?.toUpperCase() ?? null;
  const gstinIsBuyer = parsedGstin != null && isBuyerGstin(parsedGstin, parties);
  const nameIsBuyer = isBuyerCompany(parsed.company_name, parties);
  // The LLM sometimes grabs the line-item table header ("S.No. PARTICULARS QTY. RATE …"),
  // the invoice title, or the whole header blob as company_name — all junk vendor names.
  const nameIsJunk = isJunkVendorName(parsed.company_name);

  // A confident (labeled) seller GSTIN that differs from what was parsed is authoritative.
  const authoritativeMismatch =
    parties.sellerConfident &&
    seller.gstin != null &&
    parsedGstin != null &&
    seller.gstin !== parsedGstin;

  const shouldFix =
    gstinIsBuyer ||
    nameIsBuyer ||
    nameIsJunk ||
    authoritativeMismatch ||
    parsedGstin == null ||
    (seller.gstin != null && parsedGstin != null && seller.gstin !== parsedGstin && (gstinIsBuyer || nameIsBuyer || parties.sellerConfident));

  if (!shouldFix) return parsed;
  if (!seller.gstin && !seller.name && !nameIsJunk && !nameIsBuyer) return parsed;

  const nameNeedsReplacement = nameIsJunk || nameIsBuyer;
  const company_name = seller.name ?? (nameNeedsReplacement ? null : parsed.company_name);

  const parsedPanIsBuyer =
    parsed.pan != null && parties.buyerPans.has(parsed.pan.toUpperCase());

  const gstin =
    seller.gstin ??
    (gstinIsBuyer ? null : parsed.gstin);

  const pan =
    seller.pan ??
    (parsedPanIsBuyer ? null : parsed.pan);

  return {
    ...parsed,
    company_name,
    gstin,
    pan,
  };
}
