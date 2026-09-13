/**
 * WebhookDelivery Sequelize model — logs each webhook delivery attempt.
 */
import { DataTypes, Model, type Sequelize } from 'sequelize';

export interface WebhookDeliveryAttributes {
  id: string;
  endpointId: string;
  event: string;
  payload: Record<string, unknown>;
  statusCode: number | null;
  responseBody: string | null;
  attempt: number;
  success: boolean;
  error: string | null;
  createdAt: Date;
}

export class WebhookDelivery extends Model<WebhookDeliveryAttributes> implements WebhookDeliveryAttributes {
  declare id: string;
  declare endpointId: string;
  declare event: string;
  declare payload: Record<string, unknown>;
  declare statusCode: number | null;
  declare responseBody: string | null;
  declare attempt: number;
  declare success: boolean;
  declare error: string | null;
  declare createdAt: Date;
}

export function initWebhookDeliveryModel(seq: Sequelize): void {
  WebhookDelivery.init({
    id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
    endpointId: { type: DataTypes.TEXT, allowNull: false, field: 'endpoint_id' },
    event: { type: DataTypes.TEXT, allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false },
    statusCode: { type: DataTypes.INTEGER, field: 'status_code' },
    responseBody: { type: DataTypes.TEXT, field: 'response_body' },
    attempt: { type: DataTypes.INTEGER, allowNull: false },
    success: { type: DataTypes.BOOLEAN, allowNull: false },
    error: { type: DataTypes.TEXT },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at', defaultValue: DataTypes.NOW },
  }, {
    sequelize: seq,
    tableName: 'webhook_deliveries',
    timestamps: false,
    indexes: [
      { fields: ['endpoint_id', { name: 'created_at', order: 'DESC' }], name: 'webhook_deliveries_endpoint_idx' },
    ],
  });
}
