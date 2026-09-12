/**
 * Organization Sequelize model — the multi-tenancy root.
 *
 * Every customer gets one organization. All their bills, vendors,
 * and analytics are scoped to this org_id.
 */
import { DataTypes, Model, type Sequelize } from 'sequelize';

const ORG_STATUSES = ['active', 'suspended'] as const;
const ORG_PLANS = ['free', 'starter', 'business', 'enterprise'] as const;

export type OrgStatus = typeof ORG_STATUSES[number];
export type OrgPlan = typeof ORG_PLANS[number];

export interface OrganizationAttributes {
  orgId: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  settings: Record<string, unknown> | null;
  invoiceLimit: number;
  createdAt: Date;
  updatedAt: Date;
}

export class Organization extends Model<OrganizationAttributes> implements OrganizationAttributes {
  declare orgId: string;
  declare name: string;
  declare slug: string;
  declare plan: string;
  declare status: string;
  declare settings: Record<string, unknown> | null;
  declare invoiceLimit: number;
  declare createdAt: Date;
  declare updatedAt: Date;
}

export function initOrganizationModel(seq: Sequelize): void {
  Organization.init({
    orgId: { type: DataTypes.TEXT, primaryKey: true, field: 'org_id' },
    name: { type: DataTypes.TEXT, allowNull: false },
    slug: { type: DataTypes.TEXT, allowNull: false, unique: true },
    plan: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'free', validate: { isIn: [ORG_PLANS] } },
    status: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'active', validate: { isIn: [ORG_STATUSES] } },
    settings: { type: DataTypes.JSONB },
    invoiceLimit: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 50, field: 'invoice_limit' },
    createdAt: { type: DataTypes.DATE, allowNull: false, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, field: 'updated_at' },
  }, {
    sequelize: seq, tableName: 'organizations', timestamps: false,
    indexes: [
      { unique: true, fields: ['slug'], name: 'orgs_slug_idx' },
    ],
  });
}
