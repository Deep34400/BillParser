import { describe, it, expect } from 'vitest';
import { bearerFromRequest } from '../../src/middleware/auth.js';

describe('bearerFromRequest', () => {
  it('reads Authorization Bearer header', () => {
    const token = bearerFromRequest({
      headers: { authorization: 'Bearer abc.def' },
      url: '/api/invoices/1',
    });
    expect(token).toBe('abc.def');
  });

  it('reads ?token= for invoice file preview (iframe cannot send headers)', () => {
    const token = bearerFromRequest({
      headers: {},
      url: '/api/invoices/af83ae25-8cbe-4767-980b-110c0b09bff8/file?token=eyJhbG.test',
    });
    expect(token).toBe('eyJhbG.test');
  });

  it('does not accept ?token= on non-file routes', () => {
    const token = bearerFromRequest({
      headers: {},
      url: '/api/invoices/1?token=secret',
    });
    expect(token).toBeUndefined();
  });
});
