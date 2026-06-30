import { describe, it, expect } from 'vitest';
import { sha256 } from '../../src/lib/hash.js';
it('hashes deterministically', () => {
  const a = sha256(Buffer.from('hello'));
  expect(a).toBe(sha256(Buffer.from('hello')));
  expect(a).toHaveLength(64);
  expect(a).not.toBe(sha256(Buffer.from('world')));
});
