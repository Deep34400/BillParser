// Tracks in-flight extractions so a user can cancel one mid-run. In-memory by design:
// a cancel only affects an extraction running in THIS process (single-instance deployment).
const RUNNING = new Map<string, AbortController>();

// Register a new cancellable run for an invoice. If one is somehow already registered
// (a stale/duplicate run), abort it first so we never leak an un-cancellable controller.
export function startCancellable(invoiceId: string): AbortController {
  const existing = RUNNING.get(invoiceId);
  if (existing) existing.abort();
  const controller = new AbortController();
  RUNNING.set(invoiceId, controller);
  return controller;
}

// Clear the registration once a run settles — but only if it's still THIS controller,
// so a newer run for the same invoice isn't accidentally unregistered.
export function finishCancellable(invoiceId: string, controller: AbortController): void {
  if (RUNNING.get(invoiceId) === controller) RUNNING.delete(invoiceId);
}

// Abort the running extraction for an invoice. Returns true if one was running.
export function requestCancel(invoiceId: string): boolean {
  const controller = RUNNING.get(invoiceId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export function isCancelError(e: unknown): boolean {
  const err = e as { name?: string; message?: string } | null;
  return err?.name === 'AbortError' || /abort/i.test(String(err?.message ?? ''));
}
