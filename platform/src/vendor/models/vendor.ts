/**
 * Vendor Sequelize model.
 */
import { DataTypes, Model, type Sequelize, type Optional } from 'sequelize';

export interface VendorAttributes {
  vendorId: string;
  legalName: string | null;
  displayName: string | null;
  gstin: string | null;
  pan: string | null;
  invoiceCount: number;
  firstSeen: Date;
  lastSeen: Date;
  parserName: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export class Vendor extends Model<VendorAttributes, Optional<VendorAttributes, 'invoiceCount'>> implements VendorAttributes {
  declare vendorId: string;
  declare legalName: string | null;
  declare displayName: string | null;
  declare gstin: string | null;
  declare pan: string | null;
  declare invoiceCount: number;
  declare firstSeen: Date;
  declare lastSeen: Date;
  declare parserName: string | null;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export function initVendorModel(seq: Sequelize): void {
  Vendor.init({
    vendorId: { type: DataTypes.TEXT, primaryKey: true, field: 'vendor_id' },
    legalName: { type: DataTypes.TEXT, field: 'legal_name' },
    displayName: { type: DataTypes.TEXT, field: 'display_name' },
    gstin: DataTypes.TEXT,
    pan: DataTypes.TEXT,
    invoiceCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0, field: 'invoice_count' },
    firstSeen: { type: DataTypes.DATE, allowNull: false, field: 'first_seen' },
    lastSeen: { type: DataTypes.DATE, allowNull: false, field: 'last_seen' },
    parserName: { type: DataTypes.TEXT, field: 'parser_name' },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
  }, {
    sequelize: seq, tableName: 'vendors', timestamps: false,
    indexes: [
      { fields: ['gstin'], name: 'vendors_gstin_idx' },
      { fields: ['pan'], name: 'vendors_pan_idx' },
      { fields: [seq.fn('lower', seq.col('legal_name'))], name: 'vendors_legalname_idx' },
      { fields: [{ name: 'invoice_count', order: 'DESC' }], name: 'vendors_count_idx' },
    ],
  });
}
