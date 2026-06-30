import type { ExtractionProvider, CanonicalResult } from './types.js';
import { getStructuringModel } from '../structuring/index.js';
import { rasterizePdf, rasterizeTopBand } from '../lib/rasterize.js';
import { ollamaChat } from './clients/ollama.js';

const OCR_PROMPT =
  'You are an OCR engine. Transcribe this invoice image to clean GitHub-flavored Markdown. ' +
  'Preserve every line-item table row, number, date, and label exactly as printed. ' +
  'Output only the transcription — no commentary, no code fences.';

// The full-page OCR pass focuses on line-item tables and tends to skip the letterhead,
// leaving vendorName/invoiceNumber empty. A cheap second pass over just the cropped top
// band of page 1, with a metadata-focused prompt, recovers those header fields without
// pushing any single OCR request past the timeout.
const HEADER_PROMPT =
  'You are an OCR engine. This image is the top/header section of an invoice. Transcribe it to ' +
  'plain Markdown, capturing the vendor/seller name and address, tax IDs (GSTIN/PAN/VAT), ' +
  'invoice number, invoice date, due date, PO number, and bill-to/customer details. ' +
  'Output only the transcription — no commentary, no code fences.';

// glm-ocr sometimes ignores the markdown instruction and runs away, transcribing a page as
// repeated ```json code blocks. Left in, that soup dominates the structuring input and the
// model returns empty results. Strip fenced code blocks (and a trailing unclosed fence from
// a truncated runaway) so only the clean table/text transcription reaches structuring.
export function stripCodeFences(s: string): string {
  return s
    .replace(/```[a-z]*\n?[\s\S]*?```/gi, '') // complete fenced blocks
    .replace(/```[a-z]*\n?[\s\S]*$/i, '') // trailing unclosed fence (truncated runaway)
    .trim();
}

export const ollamaProvider: ExtractionProvider = {
  name: 'ollama',
  displayName: 'GLM-OCR (Ollama)',
  kind: 'markdown',
  requiredCredentials: ['baseUrl', 'model'],
  isConfigured: (c) => !!c?.baseUrl && !!c?.model,
  async extract(file, creds, ctx) {
    const signal = ctx.signal; // user-cancel signal, threaded into every OCR request
    // Header pass: OCR just the cropped top band of page 1 for the letterhead metadata.
    // temperature 0 (greedy) makes glm-ocr's transcription reproducible run-to-run.
    const band = await rasterizeTopBand(file);
    const { content: headerMd, raw: headerRaw } = await ollamaChat(
      creds.baseUrl, creds.model, HEADER_PROMPT, { images: [band], temperature: 0, signal },
    );

    const images = await rasterizePdf(file);
    // OCR one page per request; a single multi-image message can cause local vision
    // models to transcribe only the first image, silently dropping later pages.
    const parts: string[] = [];
    const raws: unknown[] = [];
    for (const img of images) {
      const { content, raw } = await ollamaChat(creds.baseUrl, creds.model, OCR_PROMPT, { images: [img], temperature: 0, signal });
      parts.push(stripCodeFences(content));
      raws.push(raw);
    }
    // Prepend the header markdown so structuring sees vendor/invoice-number alongside the tables.
    const markdown = [headerMd, ...parts].join('\n\n');
    const { model, creds: sCreds } = await getStructuringModel();
    const fields = await model.structure(markdown, sCreds);
    const out: CanonicalResult = { ...fields, rawText: markdown, rawJson: { header: headerRaw, pages: raws } };
    return out;
  },
};
