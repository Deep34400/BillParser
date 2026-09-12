/**
 * BillPart Sequelize model — line items (PART / LABOUR) for each bill.
 */
import { DataTypes, Model, type Sequelize } from 'sequelize';
import { LINE_TYPES } from '../../shared/constants.js';

export interface BillPartAttributes {
  partId: string;
  billId: string;
  lineType: string;
  name: string | null;
  description: string | null;
  quantity: number | null;
  rate: number | null;
  amount: number | null;
  taxPercentage: number | null;
  taxAmount: number | null;
  partNumber: string | null;
  hsnSacCode: string | null;
  manufacturer: string | null;
  normalizedName: string | null;
  confidenceScore: number | null;
  createdAt: Date;
}

export class BillPart extends Model<BillPartAttributes> implements BillPartAttributes {
  declare partId: string;
  declare billId: string;
  declare lineType: string;
  declare name: string | null;
  declare description: string | null;
  declare quantity: number | null;
  declare rate: number | null;
  declare amount: number | null;
  declare taxPercentage: number | null;
  declare taxAmount: number | null;
  declare partNumber: string | null;
  declare hsnSacCode: string | null;
  declare manufacturer: string | null;
  declare normalizedName: string | null;
  declare confidenceScore: number | null;
  declare createdAt: Date;
}

export function initBillPartModel(seq: Sequelize): void {
  BillPart.init({
    partId: { type: DataTypes.TEXT, primaryKey: true, field: 'part_id' },
    billId: { type: DataTypes.TEXT, allowNull: false, field: 'bill_id', references: { model: 'bills', key: 'bill_id' }, onDelete: 'CASCADE' },
    lineType: { type: DataTypes.TEXT, allowNull: false, field: 'line_type', validate: { isIn: [LINE_TYPES] } },
    name: DataTypes.TEXT,
    description: DataTypes.TEXT,
    quantity: { type: DataTypes.DECIMAL(12, 3) },
    rate: { type: DataTypes.DECIMAL(14, 2) },
    amount: { type: DataTypes.DECIMAL(14, 2) },
    taxPercentage: { type: DataTypes.DECIMAL(6, 3), field: 'tax_percentage' },
    taxAmount: { type: DataTypes.DECIMAL(14, 2), field: 'tax_amount' },
    partNumber: { type: DataTypes.TEXT, field: 'part_number' },
    hsnSacCode: { type: DataTypes.TEXT, field: 'hsn_sac_code' },
    manufacturer: DataTypes.TEXT,
    normalizedName: { type: DataTypes.TEXT, field: 'normalized_name' },
    confidenceScore: { type: DataTypes.REAL, field: 'confidence_score' },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
  }, {
    sequelize: seq, tableName: 'bill_parts', timestamps: false,
    indexes: [
      { fields: ['bill_id'], name: 'parts_bill_idx' },
      { fields: [{ name: 'created_at', order: 'DESC' }], name: 'parts_created_idx' },
    ],
  });
}
