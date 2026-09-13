import { audit } from '../../audit/service.js';
import type { AuditAction } from '../../audit/models/index.js';
import { dispatchWebhookEvent } from '../../webhook/service.js';
import type { WebhookEvent } from '../../webhook/models/index.js';

export function recordActivity(
  userId: string | undefined,
  action: AuditAction,
  event: WebhookEvent | null,
  billId: string,
  details?: Record<string, unknown>,
): void {
  if (!userId) return;
  audit(action, { userId, resourceType: 'bill', resourceId: billId, details: details ?? null });
  if (event) dispatchWebhookEvent(userId, event, { billId, ...(details ?? {}) });
}
