import { it, expect, vi, afterEach } from 'vitest';

const generateContent = vi.fn();

vi.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: () => ({ generateContent }),
  })),
}));

import { geminiModel } from '../../src/structuring/gemini.js';

afterEach(() => {
  vi.clearAllMocks();
});

it('returns the structuring cost computed from token usage', async () => {
  generateContent.mockResolvedValueOnce({
    response: {
      text: () => '{"lineItems":[]}',
      usageMetadata: { promptTokenCount: 5698, candidatesTokenCount: 3603 },
    },
  });
  const r = await geminiModel('gemini-2.5-flash').structure('# md', { apiKey: 'k' });
  // gemini-2.5-flash = [$0.15,$0.60]/1M -> (5698*0.15 + 3603*0.60)/1e6
  expect(r.structuringCost).toBeCloseTo((5698 * 0.15 + 3603 * 0.60) / 1e6, 9);
});

it('retries once when the model returns unrecoverable JSON', async () => {
  generateContent
    .mockResolvedValueOnce({
      response: {
        text: () => '{ this is not valid json at all',
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      },
    })
    .mockResolvedValueOnce({
      response: {
        text: () => '{"vendorName":"Acme","lineItems":[]}',
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 },
      },
    });
  const r = await geminiModel('gemini-2.5-flash').structure('# md', { apiKey: 'k' });
  expect(r.vendorName).toBe('Acme');
  expect(generateContent).toHaveBeenCalledTimes(2);
});

it('does not retry when comma numbers are auto-repaired', async () => {
  generateContent.mockResolvedValueOnce({
    response: {
      text: () => '{"output":{"entries":[{"parsed_data":{"parts_line_items":[{"taxable_amount": 1,633.92}],"confidence":0.9}}]}}',
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
    },
  });
  const r = await geminiModel('gemini-2.5-flash').structure('# md', { apiKey: 'k' });
  expect(r.parsedData?.parts_line_items?.[0]?.taxable_amount).toBe(1633.92);
  expect(generateContent).toHaveBeenCalledTimes(1);
});
