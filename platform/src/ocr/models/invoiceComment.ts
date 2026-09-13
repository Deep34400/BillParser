/**
 * InvoiceComment Sequelize model — user notes on a bill.
 */
import { DataTypes, Model, type Sequelize } from 'sequelize';

export interface InvoiceCommentAttributes {
  id: string;
  billId: string;
  userId: string;
  text: string;
  createdAt: Date;
}

export class InvoiceComment extends Model<InvoiceCommentAttributes> implements InvoiceCommentAttributes {
  declare id: string;
  declare billId: string;
  declare userId: string;
  declare text: string;
  declare createdAt: Date;
}

export function initInvoiceCommentModel(seq: Sequelize): void {
  InvoiceComment.init({
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    billId: { type: DataTypes.TEXT, allowNull: false, field: 'bill_id' },
    userId: { type: DataTypes.TEXT, allowNull: false, field: 'user_id' },
    text: { type: DataTypes.TEXT, allowNull: false },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at', defaultValue: DataTypes.NOW },
  }, {
    sequelize: seq,
    tableName: 'invoice_comments',
    timestamps: false,
    indexes: [
      { fields: ['bill_id'], name: 'invoice_comments_bill_idx' },
      { fields: [{ name: 'created_at', order: 'ASC' }], name: 'invoice_comments_created_idx' },
    ],
  });
}
