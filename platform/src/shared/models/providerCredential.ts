/**
 * ProviderCredential Sequelize model — API keys per provider.
 */
import { DataTypes, Model, type Sequelize } from 'sequelize';

export interface ProviderCredentialAttributes {
  provider: string;
  credentials: Record<string, unknown>;
}

export class ProviderCredential extends Model<ProviderCredentialAttributes> implements ProviderCredentialAttributes {
  declare provider: string;
  declare credentials: Record<string, unknown>;
}

export function initProviderCredentialModel(seq: Sequelize): void {
  ProviderCredential.init({
    provider: { type: DataTypes.TEXT, primaryKey: true },
    credentials: { type: DataTypes.JSONB, allowNull: false },
  }, {
    sequelize: seq, tableName: 'provider_credentials', timestamps: false,
  });
}
