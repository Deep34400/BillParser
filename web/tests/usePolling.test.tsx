import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePolling } from '../src/hooks/usePolling.js';
it('stops polling when shouldContinue returns false', async () => {
  const fn = vi.fn().mockResolvedValue('x');
  renderHook(() => usePolling(fn, () => false, 10));
  await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
  await new Promise((r) => setTimeout(r, 40));
  expect(fn).toHaveBeenCalledTimes(1);
});
