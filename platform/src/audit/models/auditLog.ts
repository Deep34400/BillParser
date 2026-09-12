/**
 * AuditLog Sequelize model — tracks all user actions for accountability.
 */
import { DataTypes, Model, type Sequelize } from 'sequelize';

export const AUDIT_ACTIONS = [
  'invoice:upload', 'invoice:edit', 'invoice:delete', 'invoice:reextract',
  'invoice:approve', 'invoice:reject', 'invoice:submit_approval', 'invoice:cancel',
  'invoice:bulk_delete', 'invoice:bulk_reextract',
  'org:create', 'org:update',
  'member:invite', 'member:role_change', 'member:remove',
  'user:create', 'user:block', 'user:unblock', 'user:reset_password',
  'tokens:credit', 'tokens:debit',
  'settings:update', 'credentials:update',
  'webhook:create', 'webhook:update', 'webhook:delete',
] as const;

export type AuditAction = typeof AUDIT_ACTIONS[number];

export interface AuditLogAttributes {
  logId: string;
  orgId: string | null;
  userId: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: Date;
}

export class AuditLog extends Model<AuditLogAttributes> implements AuditLogAttributes {
  declare logId: string;
  declare orgId: string | null;
  declare userId: string | null;
  declare action: string;
  declare resourceType: string | null;
  declare resourceId: string | null;
  declare details: Record<string, unknown> | null;
  declare ipAddress: string | null;
  declare createdAt: Date;
}

export function initAuditLogModel(seq: Sequelize): void {
  AuditLog.init({
    logId: { type: DataTypes.TEXT, primaryKey: true, field: 'log_id' },
    orgId: { type: DataTypes.TEXT, field: 'org_id' },
    userId: { type: DataTypes.TEXT, field: 'user_id' },
    action: { type: DataTypes.TEXT, allowNull: false },
    resourceType: { type: DataTypes.TEXT, field: 'resource_type' },
    resourceId: { type: DataTypes.TEXT, field: 'resource_id' },
    details: { type: DataTypes.JSONB },
    ipAddress: { type: DataTypes.TEXT, field: 'ip_address' },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
  }, {
    sequelize: seq,
    tableName: 'audit_logs',
    timestamps: false,
    indexes: [
      { fields: ['org_id', { name: 'created_at', order: 'DESC' }], name: 'audit_org_created_idx' },
      { fields: ['user_id', { name: 'created_at', order: 'DESC' }], name: 'audit_user_created_idx' },
      { fields: ['action'], name: 'audit_action_idx' },
      { fields: ['resource_type', 'resource_id'], name: 'audit_resource_idx' },
    ],
  });
}
