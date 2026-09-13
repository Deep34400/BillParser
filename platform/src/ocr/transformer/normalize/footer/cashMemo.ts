import { parseMoneyToken, moneyTokensFromText } from './gst.js';

/**
 * Handwritten cash-memo TOTAL row — e.g. "| TOTAL | 5700 |" on AJAY PAL bills.
 * Not "Sub Total" — only the final TOTAL column in the item table footer.
 */
export function extractCashMemoTotal(md: string): number | null {
  for (const line of md.split(/\r?\n/)) {
    if (!/\bTOTAL\b/i.test(line) || /sub\s*total/i.test(line)) continue;
    const cells = line.split('|').map((c) => c.trim());
    for (let i = 0; i < cells.length - 1; i++) {
      if (/^TOTAL$/i.test(cells[i])) {
        const n = parseMoneyToken(cells[i + 1]);
        if (n != null && n > 0) return n;
      }
    }
    const nums = moneyTokensFromText(line);
    if (nums.length) return nums[nums.length - 1];
  }
  return null;
}
