import { geminiGenerate } from '../providers/clients/gemini.js';
import { isPdf } from '../lib/pdf.js';
import { stripCodeFences } from '../providers/ollama.js';
import { footerMissingInMarkdown } from './footerExtract.js';

/** Focused OCR pass when the main extractor skipped the bill summary table. */
export const OCR_FOOTER_PROMPT =
  'You are an OCR engine. Transcribe ONLY the bill summary / totals footer from this Indian service invoice. ' +
  'CRITICAL: if a charge table exists with Labour and Parts rows, transcribe each row verbatim:\n' +
  '| Labour | gross | discount | taxable | cgst | sgst | amount_with_tax |\n' +
  '| Parts | gross | discount | taxable | cgst | sgst | amount_with_tax |\n' +
  'The first number in each row is GROSS (before discount), NOT taxable after discount.\n' +
  'Also include side-specific GST lines if printed (Central GST for Parts @ 9% : …).\n' +
  'For two-column footers also include: Sub Total Amount (parts | labour), Less Discount, CGST @ %, SGST @ %, Net Bill Amount.\n' +
  'Output plain markdown lines only — no commentary, no code fences.';

/** Gemini PDF pass to recover the summary footer Mistral OCR often drops. */
export async function geminiFooterSupplement(
  file: Buffer,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!isPdf(file)) return null;
  try {
    const { text } = await geminiGenerate(
      apiKey,
      model,
      OCR_FOOTER_PROMPT,
      [{ inlineData: { data: file.toString('base64'), mimeType: 'application/pdf' } }],
      signal,
      { temperature: 0 },
    );
    const md = stripCodeFences(text);
    if (md.length < 20 || footerMissingInMarkdown(md)) return null;
    return md;
  } catch {
    return null;
  }
}

export { footerMissingInMarkdown };
