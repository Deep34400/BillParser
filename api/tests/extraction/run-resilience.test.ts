import { it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/config/db.js';
import { runExtraction } from '../../src/extraction/run.js';

beforeEach(async () => { await prisma.invoice.deleteMany(); });

// Regression: a background runExtraction whose invoice no longer exists must NOT reject.
// Previously the catch block called prisma.extractionRun.create(), which threw a foreign-key
// error (the invoice was gone), escaping as an unhandled rejection that crashed the API.
it('does not reject when the invoice was deleted mid-flight', async () => {
  await expect(runExtraction('nonexistent-invoice-id')).resolves.toBeUndefined();
});
