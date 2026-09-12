/**
 * Audit Repository — data access for audit logs.
 */
import { Op } from 'sequelize';
import { AuditLog } from './models/index.js';

export interface AuditLogDoc {
  log_id: string;
  org_id: string | null;
  user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

function rowToDoc(row: AuditLog): AuditLogDoc {
  return {
    log_id: row.logId,
    org_id: row.orgId,
    user_id: row.userId,
    action: row.action,
    resource_type: row.resourceType,
    resource_id: row.resourceId,
    details: row.details,
    ip_address: row.ipAddress,
    created_at: row.createdAt.toISOString(),
  };
}

export async function insertAuditLog(doc: AuditLogDoc): Promise<void> {
  await AuditLog.create({
    logId: doc.log_id,
    orgId: doc.org_id,
    userId: doc.user_id,
    action: doc.action,
    resourceType: doc.resource_type,
    resourceId: doc.resource_id,
    details: doc.details,
    ipAddress: doc.ip_address,
    createdAt: new Date(doc.created_at),
  });
}

export interface AuditListFilters {
  orgId?: string;
  userId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  limit?: number;
  offset?: number;
}

export async function listAuditLogs(filters: AuditListFilters): Promise<{ logs: AuditLogDoc[]; total: number }> {
  const where: Record<string, unknown> = {};
  if (filters.orgId) where.orgId = filters.orgId;
  if (filters.userId) where.userId = filters.userId;
  if (filters.action) where.action = filters.action;
  if (filters.resourceType) where.resourceType = filters.resourceType;
  if (filters.resourceId) where.resourceId = filters.resourceId;

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  const { rows, count } = await AuditLog.findAndCountAll({
    where,
    order: [['createdAt', 'DESC']],
    limit,
    offset,
  });

  return { logs: rows.map(rowToDoc), total: count };
}
