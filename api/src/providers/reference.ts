// Representative cost/accuracy reference (PRD, mid-2026). Used for bake-off display + cost estimate.
export const PROVIDER_REFERENCE: Record<string, { costPer1k: number; headerAcc: number; lineAcc: number; pattern: string }> = {
  mistral:    { costPer1k: 2,   headerAcc: 0.9,  lineAcc: 0.85, pattern: 'OCR→md + LLM' },
  azure:      { costPer1k: 10,  headerAcc: 0.93, lineAcc: 0.87, pattern: 'prebuilt invoice' },
  llamaparse: { costPer1k: 9,   headerAcc: 0.9,  lineAcc: 0.85, pattern: 'OCR→md + LLM' },
  textract:   { costPer1k: 10,  headerAcc: 0.78, lineAcc: 0.82, pattern: 'structured fields' },
  google:     { costPer1k: 20,  headerAcc: 0.4,  lineAcc: 0.4,  pattern: 'structured fields' },
};
