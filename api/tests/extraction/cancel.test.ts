import { it, expect } from 'vitest';
import { startCancellable, finishCancellable, requestCancel, isCancelError } from '../../src/extraction/cancel.js';

it('aborts a registered run and reports whether one was running', () => {
  const c = startCancellable('inv-1');
  expect(c.signal.aborted).toBe(false);
  expect(requestCancel('inv-1')).toBe(true);
  expect(c.signal.aborted).toBe(true);
  // already finished / never started -> false
  expect(requestCancel('inv-unknown')).toBe(false);
});

it('finishCancellable only clears its own controller (no stale removal)', () => {
  const a = startCancellable('inv-2');
  const b = startCancellable('inv-2'); // re-registering aborts the previous one
  expect(a.signal.aborted).toBe(true);
  finishCancellable('inv-2', a); // a is stale; must NOT remove b's registration
  expect(requestCancel('inv-2')).toBe(true); // b still cancellable
  expect(b.signal.aborted).toBe(true);
});

it('recognizes abort errors', () => {
  expect(isCancelError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
  expect(isCancelError(new Error('The operation was aborted'))).toBe(true);
  expect(isCancelError(new Error('network down'))).toBe(false);
});
