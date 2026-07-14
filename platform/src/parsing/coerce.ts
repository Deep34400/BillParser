export const toNum = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

export const toStr = (v: unknown): string | undefined =>
  (v === null || v === undefined || v === '') ? undefined : String(v).trim();

export const toNullableNum = (v: unknown): number | null | undefined => {
  if (v === null) return null;
  const n = toNum(v);
  return n === undefined ? undefined : n;
};

export const toNullableStr = (v: unknown): string | null | undefined => {
  if (v === null) return null;
  return toStr(v);
};

/** Parse DD/MM/YYYY or ISO to yyyy-mm-dd for DB storage. */
export function parseInvoiceDate(v?: string | null): string | undefined {
  if (!v) return undefined;
  const s = v.trim();
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = /^\d{4}-\d{2}-\d{2}/.exec(s);
  if (iso) return iso[0];
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return undefined;
}

/** Strip markdown fences and return the outermost `{…}` slice. */
export function extractJsonObject(raw: string): string {
  let s = raw.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  return start >= 0 && end > start ? s.slice(start, end + 1) : s;
}

/** Remove trailing commas before `}` or `]` — common LLM mistake. */
function stripTrailingCommas(json: string): string {
  return json.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Fix unquoted Indian-formatted numbers (e.g. `: 1,823.76`) that break JSON.parse.
 * Only touches numeric tokens after `:`, `[`, or `,` — never string values.
 */
function stripCommasFromUnquotedNumbers(json: string): string {
  return json.replace(
    /([:\[,]\s*)(-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?)(?=\s*[,}\]\]]|$)/g,
    (_, prefix: string, num: string) => `${prefix}${num.replace(/,/g, '')}`,
  );
}

/** Close unbalanced braces/brackets when the model truncates mid-response. */
function repairTruncatedJson(json: string): string {
  let s = json.trim();
  const stack: ('{' | '[')[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') stack.push('{');
    else if (c === '[') stack.push('[');
    else if (c === '}' && stack[stack.length - 1] === '{') stack.pop();
    else if (c === ']' && stack[stack.length - 1] === '[') stack.pop();
  }
  if (inString) s += '"';
  while (stack.length) {
    const open = stack.pop();
    s += open === '{' ? '}' : ']';
  }
  return s;
}

/** Normalize common LLM JSON mistakes before JSON.parse. */
export function prepareLlmJson(raw: string): string {
  let s = extractJsonObject(raw);
  s = stripTrailingCommas(s);
  s = stripCommasFromUnquotedNumbers(s);
  return s;
}

/** prepareLlmJson + optional truncation repair for a second parse attempt. */
export function prepareLlmJsonWithRepair(raw: string): string {
  return repairTruncatedJson(prepareLlmJson(raw));
}
