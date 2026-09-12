/**
 * ApiKey Sequelize model.
 */
import { DataTypes, Model, type Sequelize } from 'sequelize';

export interface ApiKeyAttributes {
  keyId: string;
  userId: string;
  keyHash: string;
  keyPrefix: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export class ApiKey extends Model<ApiKeyAttributes> implements ApiKeyAttributes {
  declare keyId: string;
  declare userId: string;
  declare keyHash: string;
  declare keyPrefix: string;
  declare label: string;
  declare createdAt: Date;
  declare lastUsedAt: Date | null;
}

export function initApiKeyModel(seq: Sequelize): void {
  ApiKey.init({
    keyId: { type: DataTypes.TEXT, primaryKey: true, field: 'key_id' },
    userId: { type: DataTypes.TEXT, allowNull: false, field: 'user_id', references: { model: 'users', key: 'user_id' }, onDelete: 'CASCADE' },
    keyHash: { type: DataTypes.TEXT, allowNull: false, field: 'key_hash' },
    keyPrefix: { type: DataTypes.TEXT, allowNull: false, field: 'key_prefix' },
    label: { type: DataTypes.TEXT, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    lastUsedAt: { type: DataTypes.DATE, field: 'last_used_at' },
  }, {
    sequelize: seq, tableName: 'api_keys', timestamps: false,
    indexes: [
      { unique: true, fields: ['key_hash'], name: 'keys_hash_idx' },
      { fields: ['user_id', { name: 'created_at', order: 'DESC' }], name: 'keys_user_idx' },
    ],
  });
}
