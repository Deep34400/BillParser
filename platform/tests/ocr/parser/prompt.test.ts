import { describe, it, expect } from 'vitest';
import { STRUCTURING_PROMPT } from '../../../src/ocr/parser/prompt.js';

describe('STRUCTURING_PROMPT taxable_amount', () => {
  it('keeps normal qty×rate rule and adds exception for printed 0 / partial Taxable Amount', () => {
    // Existing happy-path rule unchanged
    expect(STRUCTURING_PROMPT).toMatch(
      /Line items are GROSS \(amount BEFORE any discount\)\. taxable_amount = quantity × rate/i,
    );
    // Edge-case: insurance / body-repair printed column
    expect(STRUCTURING_PROMPT).toMatch(/Taxable Amount/i);
    expect(STRUCTURING_PROMPT).toMatch(/insurance|body-repair/i);
    expect(STRUCTURING_PROMPT).toMatch(/including 0/i);
  });
});
