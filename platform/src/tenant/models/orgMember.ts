/**
 * OrgMember Sequelize model — maps users to organizations with a role.
 *
 * A user can belong to exactly one org (for now).
 * The org_role determines what actions they can perform within the org.
 */
import { DataTypes, Model, type Sequelize } from 'sequelize';

export const ORG_ROLES = ['owner', 'admin', 'reviewer', 'viewer', 'api_user'] as const;
export type OrgRole = typeof ORG_ROLES[number];

export interface OrgMemberAttributes {
  orgId: string;
  userId: string;
  orgRole: string;
  joinedAt: Date;
}

export class OrgMember extends Model<OrgMemberAttributes> implements OrgMemberAttributes {
  declare orgId: string;
  declare userId: string;
  declare orgRole: string;
  declare joinedAt: Date;
}

export function initOrgMemberModel(seq: Sequelize): void {
  OrgMember.init({
    orgId: { type: DataTypes.TEXT, allowNull: false, primaryKey: true, field: 'org_id' },
    userId: { type: DataTypes.TEXT, allowNull: false, primaryKey: true, field: 'user_id' },
    orgRole: { type: DataTypes.TEXT, allowNull: false, defaultValue: 'viewer', field: 'org_role', validate: { isIn: [ORG_ROLES] } },
    joinedAt: { type: DataTypes.DATE, allowNull: false, field: 'joined_at' },
  }, {
    sequelize: seq, tableName: 'org_members', timestamps: false,
    indexes: [
      { fields: ['user_id'], name: 'orgmembers_user_idx' },
      { fields: ['org_id', 'org_role'], name: 'orgmembers_org_role_idx' },
    ],
  });
}
