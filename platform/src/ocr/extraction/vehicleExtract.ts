import type { VehicleDetails } from '../parsing/types.js';

/** Classic Indian plate: MH01FE2778, KA51AK8534. BH series: 22BH1234A. */
const INDIAN_REG_RE = /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{4}$|^\d{2}BH\d{4}[A-Z]$/;

const REG_LABEL_RE =
  /\b(?:reg(?:istration)?\.?\s*(?:no|number)?|vehicle\s*(?:reg(?:istration)?)?\.?\s*(?:no|number)?|veh\.?\s*no)\.?\s*[:\-/]?\s*([A-Z0-9][A-Z0-9\s]{2,14})/gi;

/** Strip spaces and validate — returns compact uppercase plate or null. */
export function normalizeRegistrationNumber(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const compact = raw.replace(/\s+/g, '').toUpperCase();
  return INDIAN_REG_RE.test(compact) ? compact : null;
}

function cleanRegCapture(raw: string): string {
  return raw.split(/[(,;\n|]/)[0].trim();
}

/** Read vehicle registration straight from OCR markdown when the LLM misses it. */
export function extractRegistrationFromMarkdown(markdown?: string | null): string | null {
  if (!markdown) return null;

  for (const m of markdown.matchAll(REG_LABEL_RE)) {
    const candidate = normalizeRegistrationNumber(cleanRegCapture(m[1]));
    if (candidate) return candidate;
  }

  // Bare plate on its own line (some handwritten bills).
  for (const line of markdown.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length < 6 || t.length > 16) continue;
    const candidate = normalizeRegistrationNumber(t);
    if (candidate) return candidate;
  }

  return null;
}

/** Normalize vehicle_details — registration fallback from markdown, strip spaces. */
export function normalizeVehicleDetails(
  vehicle: VehicleDetails | null | undefined,
  markdown?: string | null,
): VehicleDetails | null {
  const vd = vehicle ?? {};
  const fromParsed = normalizeRegistrationNumber(vd.registration_number);
  const fromMarkdown = extractRegistrationFromMarkdown(markdown);

  return {
    ...vd,
    registration_number: fromParsed ?? fromMarkdown ?? vd.registration_number ?? null,
    chassis_number: vd.chassis_number?.trim() || vd.chassis_number || null,
    mileage_odometer_reading: vd.mileage_odometer_reading ?? null,
  };
}
