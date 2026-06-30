import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, maskValue } from '../../src/lib/crypto.js';

describe('crypto', () => {
  const secret = 'a-very-long-test-secret-string-123';
  it('round-trips a value', () => {
    const enc = encrypt('sk-secret-key-1234', secret);
    expect(enc).not.toContain('sk-secret');
    expect(decrypt(enc, secret)).toBe('sk-secret-key-1234');
  });
  it('produces different ciphertext each call (random iv)', () => {
    expect(encrypt('x', secret)).not.toBe(encrypt('x', secret));
  });
  it('fails to decrypt with wrong secret', () => {
    const enc = encrypt('x', secret);
    expect(() => decrypt(enc, 'wrong-secret')).toThrow();
  });
  it('masks to last 4', () => {
    expect(maskValue('sk-abcd1234')).toBe('••••1234');
    expect(maskValue('ab')).toBe('••••');
  });
});
