/**
 * Batch — groups invoices uploaded together (files, zip, or URLs).
 */
import { DataTypes, Model, type Sequelize } from 'sequelize';

export const BATCH_SOURCES = ['files', 'zip', 'urls', 'mixed'] as const;
export type BatchSource = (typeof BATCH_SOURCES)[number];

export interface BatchAttributes {
  id: string;
  userId: string;
  name: string | null;
  source: string;
  totalFiles: number;
  createdAt: Date;
}

export class InvoiceBatch extends Model<BatchAttributes> implements BatchAttributes {
  declare id: string;
  declare userId: string;
  declare name: string | null;
  declare source: string;
  declare totalFiles: number;
  declare createdAt: Date;
}

export function initInvoiceBatchModel(seq: Sequelize): void {
  InvoiceBatch.init({
    id: { type: DataTypes.TEXT, primaryKey: true },
    userId: { type: DataTypes.TEXT, allowNull: false, field: 'user_id' },
    name: { type: DataTypes.TEXT, allowNull: true },
    source: { type: DataTypes.TEXT, allowNull: false, validate: { isIn: [BATCH_SOURCES as unknown as string[]] } },
    totalFiles: { type: DataTypes.INTEGER, allowNull: false, field: 'total_files' },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
  }, {
    sequelize: seq,
    tableName: 'batches',
    timestamps: false,
    indexes: [
      { fields: ['user_id', { name: 'created_at', order: 'DESC' }], name: 'idx_batches_user_created' },
    ],
  });
}
