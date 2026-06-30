import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPdf } from './pdf.js';

const exec = promisify(execFile);

// Rasterize a PDF to one base64-encoded PNG per page using poppler's pdftoppm.
// Ollama vision models accept images, not PDFs. dpi trades quality vs payload size;
// maxPages caps huge documents — passed as pdftoppm's -l (last page) with an
// implicit first page of 1, so it renders at most the first maxPages pages.
export async function rasterizePdf(
  buf: Buffer,
  opts: { dpi?: number; maxPages?: number } = {},
): Promise<string[]> {
  const dpi = opts.dpi ?? 150;
  const maxPages = opts.maxPages ?? 5;
  if (!isPdf(buf)) throw new Error('rasterizePdf: input is not a PDF');

  const dir = await mkdtemp(join(tmpdir(), 'ioc-raster-'));
  try {
    const input = join(dir, 'input.pdf');
    await writeFile(input, buf);
    const args = ['-png', '-r', String(dpi), '-l', String(maxPages), input, join(dir, 'page')];
    try {
      await exec('pdftoppm', args);
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        throw new Error('rasterizePdf: pdftoppm not found — install poppler-utils.');
      }
      throw new Error(`rasterizePdf: pdftoppm failed: ${String(e?.stderr?.toString() ?? e?.message ?? e)}`);
    }
    const files = (await readdir(dir))
      .filter((f) => f.startsWith('page') && f.endsWith('.png'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const pages = await Promise.all(
      files.map((f) => readFile(join(dir, f)).then((b) => b.toString('base64'))),
    );
    if (!pages.length) throw new Error('rasterizePdf: no pages rendered');
    return pages;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Rasterize only the top band of page 1 as a single base64 PNG. The header/letterhead
// block (vendor, invoice number, dates) lives here; OCRing just this crop with a focused
// prompt is fast and avoids asking the slow vision model to re-transcribe the whole page.
// Uses pdftoppm's crop flags: -H bounds the height (px), -W defaults to 0 = full width.
export async function rasterizeTopBand(
  buf: Buffer,
  opts: { dpi?: number; heightInches?: number } = {},
): Promise<string> {
  const dpi = opts.dpi ?? 150;
  const heightInches = opts.heightInches ?? 4;
  if (!isPdf(buf)) throw new Error('rasterizeTopBand: input is not a PDF');

  const dir = await mkdtemp(join(tmpdir(), 'ioc-raster-'));
  try {
    const input = join(dir, 'input.pdf');
    await writeFile(input, buf);
    const heightPx = Math.round(heightInches * dpi);
    const args = [
      '-png', '-r', String(dpi), '-f', '1', '-l', '1',
      '-x', '0', '-y', '0', '-H', String(heightPx),
      input, join(dir, 'header'),
    ];
    try {
      await exec('pdftoppm', args);
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        throw new Error('rasterizeTopBand: pdftoppm not found — install poppler-utils.');
      }
      throw new Error(`rasterizeTopBand: pdftoppm failed: ${String(e?.stderr?.toString() ?? e?.message ?? e)}`);
    }
    const file = (await readdir(dir)).find((f) => f.startsWith('header') && f.endsWith('.png'));
    if (!file) throw new Error('rasterizeTopBand: no band rendered');
    return (await readFile(join(dir, file))).toString('base64');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
