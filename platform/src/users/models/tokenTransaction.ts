/**
 * TokenTransaction Sequelize model — ledger for token credits/debits.
 */
import { DataTypes, Model, type Sequelize } from 'sequelize';
import { TX_TYPES } from '../../shared/constants.js';

export interface TokenTransactionAttributes {
  txId: string;
  userId: string;
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  referenceId: string | null;
  createdAt: Date;
}

export class TokenTransaction extends Model<TokenTransactionAttributes> implements TokenTransactionAttributes {
  declare txId: string;
  declare userId: string;
  declare type: string;
  declare amount: number;
  declare balanceAfter: number;
  declare description: string;
  declare referenceId: string | null;
  declare createdAt: Date;
}

export function initTokenTransactionModel(seq: Sequelize): void {
  TokenTransaction.init({
    txId: { type: DataTypes.TEXT, primaryKey: true, field: 'tx_id' },
    userId: { type: DataTypes.TEXT, allowNull: false, field: 'user_id', references: { model: 'users', key: 'user_id' }, onDelete: 'RESTRICT' },
    type: { type: DataTypes.TEXT, allowNull: false, validate: { isIn: [TX_TYPES] } },
    amount: { type: DataTypes.DECIMAL(14, 4), allowNull: false },
    balanceAfter: { type: DataTypes.DECIMAL(12, 4), allowNull: false, field: 'balance_after' },
    description: { type: DataTypes.TEXT, allowNull: false },
    referenceId: { type: DataTypes.TEXT, field: 'reference_id' },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
  }, {
    sequelize: seq, tableName: 'token_transactions', timestamps: false,
    indexes: [
      { fields: ['user_id', { name: 'created_at', order: 'DESC' }], name: 'tx_user_created_idx' },
    ],
  });
}
