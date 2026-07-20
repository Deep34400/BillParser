import { describe, it, expect } from 'vitest';
import { extractGeminiText } from '../../../src/ocr/providers/geminiClient.js';

describe('extractGeminiText', () => {
  it('skips thought parts and returns the JSON answer (Gemini 3.x)', () => {
    const json = {
      candidates: [{
        content: {
          parts: [
            { text: 'Let me analyze this invoice carefully...', thought: true },
            { text: '{"output":{"entries":[{"parsed_data":{"company_name":"Anysphere, Inc."}}]}}' },
          ],
        },
      }],
    };
    const text = extractGeminiText(json);
    expect(text).toContain('"company_name":"Anysphere, Inc."');
    expect(text).not.toContain('Let me analyze');
  });

  it('falls back to first text when no thought flag but later part is JSON', () => {
    const json = {
      candidates: [{
        content: {
          parts: [
            { text: 'reasoning notes' },
            { text: '{"company_name":"Fort Point Automotive","gstin":"27AACCP5360R1ZT"}' },
          ],
        },
      }],
    };
    expect(extractGeminiText(json)).toContain('Fort Point Automotive');
  });

  it('returns empty string when no parts', () => {
    expect(extractGeminiText({})).toBe('');
    expect(extractGeminiText({ candidates: [{ content: { parts: [] } }] })).toBe('');
  });
});
