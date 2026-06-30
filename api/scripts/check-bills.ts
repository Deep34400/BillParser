/**
 * Batch self-check for invoice parsing accuracy.
 *
 * Runs every bill in a folder and reports whether the math reconciles, i.e.
 *   parts_net + labour_net  ==  grand_total_invoice   (within ₹1)
 * where  net = subtotal - discount - special_discount + cgst + sgst + igst.
 *
 * Two input kinds (mixed freely in the same folder):
 *   - *.pdf            -> POSTed to the live API  (needs `docker compose up -d --build api`)
 *   - *.md / *.txt     -> OCR markdown, checked OFFLINE via footerExtract (no server/DB)
 *
 * Usage:
 *   npx tsx scripts/check-bills.ts <folder> [--provider mistral] [--url http://localhost:4000]
 *
 * Exit code is non-zero when any bill FAILS, so it can gate CI later.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { extractSummaryFromMarkdown } from '../src/billing/footerExtract.js';
import { columnNet } from '../src/billing/billSummary.js';
import type { TotalsAndTaxSummary } from '../src/parsing/types.js';

type Verdict = 'PASS' | 'FAIL' | 'REVIEW';
interface Row {
  file: string;
  partsNet: number | null;
  labourNet: number | null;
  sum: number | null;
  grand: number | null;
  verdict: Verdict;
  note?: string;
}

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const folder = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'bills';
const apiUrl = arg('--url') ?? process.env.API_URL ?? 'http://localhost:4000';
const provider = arg('--provider');

function reconcile(t: TotalsAndTaxSummary): Pick<Row, 'partsNet' | 'labourNet' | 'sum' | 'grand' | 'verdict' | 'note'> {
  const partsNet = columnNet(t, 'parts');
  const labourNet = columnNet(t, 'labour');
  const grand = t.grand_total_invoice ?? null;
  const sum = (partsNet ?? 0) + (labourNet ?? 0);
  if (partsNet == null && labourNet == null) return { partsNet, labourNet, sum: null, grand, verdict: 'REVIEW', note: 'no totals parsed' };
  if (grand == null) return { partsNet, labourNet, sum, grand, verdict: 'REVIEW', note: 'no grand total' };
  const ok = Math.abs(sum - grand) <= 1 || Math.round(sum) === Math.round(grand);
  return { partsNet, labourNet, sum, grand, verdict: ok ? 'PASS' : 'FAIL' };
}

async function checkPdf(path: string): Promise<Row> {
  const buf = readFileSync(path);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: 'application/pdf' }), basename(path));
  if (provider) fd.append('provider', provider);
  const res = await fetch(`${apiUrl}/api/parse`, { method: 'POST', body: fd });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { file: basename(path), partsNet: null, labourNet: null, sum: null, grand: null, verdict: 'REVIEW', note: `HTTP ${res.status} ${body.slice(0, 80)}` };
  }
  const json = (await res.json()) as { output?: { entries?: { parsed_data?: { totals_and_tax_summary?: TotalsAndTaxSummary } }[] } };
  const t = json.output?.entries?.[0]?.parsed_data?.totals_and_tax_summary ?? {};
  return { file: basename(path), ...reconcile(t) };
}

function checkMarkdown(path: string): Row {
  const md = readFileSync(path, 'utf8');
  const t = extractSummaryFromMarkdown(md) as TotalsAndTaxSummary;
  return { file: basename(path), ...reconcile(t) };
}

function money(n: number | null): string {
  return n == null ? '—' : n.toFixed(2).padStart(11);
}

async function main(): Promise<void> {
  let files: string[];
  try {
    files = readdirSync(folder).filter((f) => ['.pdf', '.md', '.txt'].includes(extname(f).toLowerCase())).sort();
  } catch {
    console.error(`Cannot read folder: ${folder}\nPut your bills there, or pass a path: npx tsx scripts/check-bills.ts <folder>`);
    process.exit(2);
  }
  if (!files.length) { console.error(`No .pdf/.md/.txt files in ${folder}`); process.exit(2); }

  console.log(`\nChecking ${files.length} bill(s) in "${folder}"  (PDFs via ${apiUrl}/api/parse)\n`);
  console.log('  verdict   parts_net    labour_net          sum         grand   file');
  console.log('  ' + '-'.repeat(86));

  const rows: Row[] = [];
  for (const f of files) {
    const path = join(folder, f);
    const row = extname(f).toLowerCase() === '.pdf' ? await checkPdf(path) : checkMarkdown(path);
    rows.push(row);
    const mark = row.verdict === 'PASS' ? 'PASS ' : row.verdict === 'FAIL' ? 'FAIL ' : 'REVIEW';
    console.log(`  ${mark}  ${money(row.partsNet)} ${money(row.labourNet)} ${money(row.sum)} ${money(row.grand)}   ${row.file}${row.note ? '  (' + row.note + ')' : ''}`);
  }

  const pass = rows.filter((r) => r.verdict === 'PASS').length;
  const fail = rows.filter((r) => r.verdict === 'FAIL').length;
  const review = rows.filter((r) => r.verdict === 'REVIEW').length;
  console.log('\n  ' + '-'.repeat(86));
  console.log(`  ${pass} PASS   ${fail} FAIL   ${review} REVIEW   of ${rows.length} total\n`);
  process.exit(fail > 0 ? 1 : 0);
}

void main();
