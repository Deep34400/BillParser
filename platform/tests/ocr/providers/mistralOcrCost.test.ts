/**
 * Mistral OCR is billed per page, not per token.
 *
 * Two things this pins down:
 *
 *  - The rate comes from Settings, not a constant. It was hardcoded at
 *    $2/1,000 pages in mistralOcr.ts, so correcting it needed a deploy — the
 *    same trap as the exchange rate that sat at 83 while the rupee moved.
 *
 *  - The step reports zero tokens rather than inventing them. It used to return
 *    pagesProcessed * 1000 fabricated tokens purely to fill the LlmUsage shape,
 *    which made a made-up number indistinguishable from a measured one wherever
 *    it surfaced, including the Analytics token totals. The page count is
 *    carried separately so the cost is still explainable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function stubOcrResponse(pages: number) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({
      pages: Array.from({ length: pages }, (_, i) => ({ markdown: `page ${i + 1} text` })),
      usage_info: { pages_processed: pages },
    }),
    text: () => Promise.resolve(''),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function runOcr(pages: number, per1kPages?: number) {
  vi.doMock('../../../src/shared/settings.js', () => ({
    getSettings: vi.fn().mockResolvedValue(
      per1kPages === undefined ? {} : { mistralOcrPricePer1kPages: per1kPages },
    ),
  }));
  vi.doMock('../../../src/ocr/providers/resolveKey.js', () => ({
    resolveProviderKey: vi.fn().mockResolvedValue({ apiKey: 'test', model: 'mistral-ocr-latest', useAdc: false }),
  }));
  stubOcrResponse(pages);
  const { mistralOcr } = await import('../../../src/ocr/providers/mistralOcr.js');
  const buf = Buffer.from('%PDF-1.4 test');
  return mistralOcr(buf, { returnCost: true }) as Promise<{ markdown: string; cost: any }>;
}

describe('Mistral OCR cost', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('bills per page at the configured rate', async () => {
    const { cost } = await runOcr(3, 2);
    expect(cost.cost_usd).toBeCloseTo(0.006, 9); // 3 / 1000 * $2
    expect(cost.pages).toBe(3);
  });

  it('follows the rate when it changes, without a deploy', async () => {
    const { cost } = await runOcr(3, 5);
    expect(cost.cost_usd).toBeCloseTo(0.015, 9);
  });

  it('falls back to the previous hardcoded rate when unset', async () => {
    const { cost } = await runOcr(3);
    // Matches the old MISTRAL_OCR_PRICE_PER_PAGE of 0.002, so existing
    // deployments see no change until someone edits the setting.
    expect(cost.cost_usd).toBeCloseTo(0.006, 9);
  });

  it('scales with page count', async () => {
    const one = await runOcr(1, 2);
    const ten = await runOcr(10, 2);
    expect(ten.cost.cost_usd).toBeCloseTo(one.cost.cost_usd * 10, 9);
  });

  it('reports zero tokens instead of fabricating them', async () => {
    const { cost } = await runOcr(4, 2);
    // Previously pages * 1000 = 4,000 invented tokens.
    expect(cost.usage.prompt_tokens).toBe(0);
    expect(cost.usage.completion_tokens).toBe(0);
    expect(cost.usage.total_tokens).toBe(0);
    // …but the cost is real, and the page count explains it.
    expect(cost.cost_usd).toBeGreaterThan(0);
    expect(cost.pages).toBe(4);
  });

  it('charges nothing when the rate is set to zero', async () => {
    const { cost } = await runOcr(5, 0);
    expect(cost.cost_usd).toBe(0);
    expect(cost.pages).toBe(5);
  });
});
