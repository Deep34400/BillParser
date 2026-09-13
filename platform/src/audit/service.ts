/**
 * Audit Service — fire-and-forget logging for all user actions.
 *
 * Usage:
 *   import { audit } from '../audit/service.js';
 *   audit('invoice:upload', { userId, resourceType: 'bill', resourceId: billId });
 *
 * Failures are silently logged to console — never block the main operation.
 */
import { v4 as uuid } from 'uuid';
import { insertAuditLog, listAuditLogs, type AuditListFilters, type AuditLogDoc } from './repository.js';
import type { AuditAction } from './models/index.js';

export interface AuditEntry {
  userId?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

/**
 * Log an audit event. Fire-and-forget — does not throw.
 */
export function audit(action: AuditAction, entry: AuditEntry): void {
  const doc: AuditLogDoc = {
    log_id: uuid(),
    user_id: entry.userId ?? null,
    action,
    resource_type: entry.resourceType ?? null,
    resource_id: entry.resourceId ?? null,
    details: entry.details ?? null,
    ip_address: entry.ipAddress ?? null,
    created_at: new Date().toISOString(),
  };

  insertAuditLog(doc).catch((err) => {
    console.error('[audit] Failed to write audit log:', err);
  });
}

/**
 * Query audit logs (for UI display).
 */
export async function getAuditLogs(filters: AuditListFilters): Promise<{ logs: AuditLogDoc[]; total: number }> {
  return listAuditLogs(filters);
}
