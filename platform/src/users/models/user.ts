/**
 * User Sequelize model.
 */
import { DataTypes, Model, type Sequelize } from 'sequelize';
import { USER_ROLES, USER_STATUSES } from '../../shared/constants.js';

export interface UserAttributes {
  userId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: string;
  status: string;
  apiKeyHash: string;
  apiKeyPrefix: string;
  tokenBalance: number;
  totalTokensUsed: number;
  totalOcrCount: number;
  totalCostUsd: number;
  intakeEmail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class User extends Model<UserAttributes> implements UserAttributes {
  declare userId: string;
  declare email: string;
  declare name: string;
  declare passwordHash: string;
  declare role: string;
  declare status: string;
  declare apiKeyHash: string;
  declare apiKeyPrefix: string;
  declare tokenBalance: number;
  declare totalTokensUsed: number;
  declare totalOcrCount: number;
  declare totalCostUsd: number;
  declare intakeEmail: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export function initUserModel(seq: Sequelize): void {
  User.init({
    userId: { type: DataTypes.TEXT, primaryKey: true, field: 'user_id' },
    email: { type: DataTypes.TEXT, allowNull: false },
    name: { type: DataTypes.TEXT, allowNull: false },
    passwordHash: { type: DataTypes.TEXT, allowNull: false, field: 'password_hash' },
    role: { type: DataTypes.TEXT, allowNull: false, validate: { isIn: [USER_ROLES] } },
    status: { type: DataTypes.TEXT, allowNull: false, validate: { isIn: [USER_STATUSES] } },
    apiKeyHash: { type: DataTypes.TEXT, allowNull: false, field: 'api_key_hash' },
    apiKeyPrefix: { type: DataTypes.TEXT, allowNull: false, field: 'api_key_prefix' },
    tokenBalance: { type: DataTypes.DECIMAL(12, 4), allowNull: false, field: 'token_balance' },
    totalTokensUsed: { type: DataTypes.DECIMAL(14, 4), allowNull: false, field: 'total_tokens_used' },
    totalOcrCount: { type: DataTypes.INTEGER, allowNull: false, field: 'total_ocr_count' },
    totalCostUsd: { type: DataTypes.DECIMAL(18, 10), allowNull: false, field: 'total_cost_usd' },
    intakeEmail: { type: DataTypes.TEXT, field: 'intake_email' },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
  }, {
    sequelize: seq, tableName: 'users', timestamps: false,
    indexes: [
      { unique: true, fields: [seq.fn('lower', seq.col('email'))], name: 'users_email_idx' },
    ],
  });
}
