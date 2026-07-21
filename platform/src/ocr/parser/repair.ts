/**
 * JSON repair helpers — fix common LLM output issues before JSON.parse.
 *
 * Handles: markdown fences, trailing commas, Indian number formatting,
 * truncated/unbalanced braces.
 */

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

/** Close unbalanced / mismatched braces when the model truncates or skips a `}`. */
export function repairTruncatedJson(json: string): string {
  let out = '';
  const stack: ('{' | '[')[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (inString) {
      out += c;
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '{') { stack.push('{'); out += c; continue; }
    if (c === '[') { stack.push('['); out += c; continue; }
    if (c === '}') {
      if (stack[stack.length - 1] === '{') {
        stack.pop();
        out += c;
      }
      continue;
    }
    if (c === ']') {
      while (stack.length && stack[stack.length - 1] === '{') {
        out += '}';
        stack.pop();
      }
      if (stack[stack.length - 1] === '[') {
        stack.pop();
        out += c;
      }
      continue;
    }
    out += c;
  }

  if (inString) out += '"';
  while (stack.length) {
    const open = stack.pop();
    out += open === '{' ? '}' : ']';
  }
  return out;
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
