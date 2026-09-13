/**
 * WebhookEndpoint Sequelize model — stores webhook subscriptions per user.
 */
import { DataTypes, Model, type Sequelize } from 'sequelize';

export const WEBHOOK_EVENTS = [
  'invoice.uploaded', 'invoice.completed', 'invoice.failed',
  'invoice.approved', 'invoice.rejected',
  'invoice.deleted',
] as const;

export type WebhookEvent = typeof WEBHOOK_EVENTS[number];

export interface WebhookEndpointAttributes {
  endpointId: string;
  userId: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class WebhookEndpoint extends Model<WebhookEndpointAttributes> implements WebhookEndpointAttributes {
  declare endpointId: string;
  declare userId: string;
  declare url: string;
  declare events: string[];
  declare secret: string;
  declare active: boolean;
  declare description: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export function initWebhookEndpointModel(seq: Sequelize): void {
  WebhookEndpoint.init({
    endpointId: { type: DataTypes.TEXT, primaryKey: true, field: 'endpoint_id' },
    userId: { type: DataTypes.TEXT, allowNull: false, field: 'user_id' },
    url: { type: DataTypes.TEXT, allowNull: false },
    events: { type: DataTypes.ARRAY(DataTypes.TEXT), allowNull: false },
    secret: { type: DataTypes.TEXT, allowNull: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    description: DataTypes.TEXT,
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
  }, {
    sequelize: seq,
    tableName: 'webhook_endpoints',
    timestamps: false,
    indexes: [
      { fields: ['user_id'], name: 'webhooks_user_idx' },
      { fields: ['active'], name: 'webhooks_active_idx' },
    ],
  });
}
