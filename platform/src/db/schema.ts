/**
 * Schema barrel — imports all domain models and wires associations.
 * This is the ONLY place that calls individual init*Model functions.
 */
import type { Sequelize } from 'sequelize';

export { Bill, type BillAttributes } from '../ocr/models/index.js';
export { BillPart, type BillPartAttributes } from '../ocr/models/index.js';
export { User, type UserAttributes } from '../users/models/index.js';
export { ApiKey, type ApiKeyAttributes } from '../users/models/index.js';
export { TokenTransaction, type TokenTransactionAttributes } from '../users/models/index.js';
export { Vendor, type VendorAttributes } from '../vendor/models/index.js';
export { AppSettingsModel as AppSettings, type AppSettingsAttributes } from '../shared/models/index.js';
export { ProviderCredential, type ProviderCredentialAttributes } from '../shared/models/index.js';
export { AuditLog, type AuditLogAttributes } from '../audit/models/index.js';
export { WebhookEndpoint, type WebhookEndpointAttributes } from '../webhook/models/index.js';
export { WebhookDelivery, type WebhookDeliveryAttributes } from '../webhook/models/index.js';

import { initBillModel, initBillPartModel, Bill, BillPart } from '../ocr/models/index.js';
import { initUserModel, initApiKeyModel, initTokenTransactionModel, User, ApiKey, TokenTransaction } from '../users/models/index.js';
import { initVendorModel, Vendor } from '../vendor/models/index.js';
import { initAppSettingsModel } from '../shared/models/index.js';
import { initProviderCredentialModel } from '../shared/models/index.js';
import { initAuditLogModel } from '../audit/models/index.js';
import { initWebhookEndpointModel, initWebhookDeliveryModel } from '../webhook/models/index.js';

export function initModels(seq: Sequelize): void {
  initVendorModel(seq);
  initUserModel(seq);
  initBillModel(seq);
  initBillPartModel(seq);
  initApiKeyModel(seq);
  initTokenTransactionModel(seq);
  initAppSettingsModel(seq);
  initProviderCredentialModel(seq);
  initAuditLogModel(seq);
  initWebhookEndpointModel(seq);
  initWebhookDeliveryModel(seq);

  Bill.belongsTo(Vendor, { foreignKey: 'vendorId', as: 'vendor' });
  Vendor.hasMany(Bill, { foreignKey: 'vendorId', as: 'bills' });
  Bill.hasMany(BillPart, { foreignKey: 'billId', as: 'parts', onDelete: 'CASCADE' });
  BillPart.belongsTo(Bill, { foreignKey: 'billId', as: 'bill' });
  User.hasMany(ApiKey, { foreignKey: 'userId', as: 'apiKeys', onDelete: 'CASCADE' });
  ApiKey.belongsTo(User, { foreignKey: 'userId', as: 'user' });
  User.hasMany(TokenTransaction, { foreignKey: 'userId', as: 'transactions', onDelete: 'RESTRICT' });
  TokenTransaction.belongsTo(User, { foreignKey: 'userId', as: 'user' });
}
