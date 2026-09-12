/**
 * Tenant Repository — data access for organizations and org members.
 */
import { Organization, OrgMember } from './models/index.js';
import type { OrgRole } from './models/index.js';
import { User } from '../users/models/user.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OrgDoc {
  org_id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  settings: Record<string, unknown> | null;
  invoice_limit: number;
  created_at: string;
  updated_at: string;
}

export interface OrgMemberDoc {
  org_id: string;
  user_id: string;
  org_role: OrgRole;
  joined_at: string;
  /** Populated via JOIN when listing members — not always present. */
  user_name?: string;
  user_email?: string;
}

// ─── Row ↔ Doc mapping ─────────────────────────────────────────────────────

function orgRowToDoc(row: Organization): OrgDoc {
  return {
    org_id: row.orgId,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    status: row.status,
    settings: row.settings,
    invoice_limit: row.invoiceLimit,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function memberRowToDoc(row: OrgMember): OrgMemberDoc {
  return {
    org_id: row.orgId,
    user_id: row.userId,
    org_role: row.orgRole as OrgRole,
    joined_at: row.joinedAt.toISOString(),
  };
}

// ─── Organization CRUD ──────────────────────────────────────────────────────

export async function createOrg(doc: OrgDoc): Promise<OrgDoc> {
  await Organization.create({
    orgId: doc.org_id,
    name: doc.name,
    slug: doc.slug,
    plan: doc.plan as any,
    status: doc.status as any,
    settings: doc.settings,
    invoiceLimit: doc.invoice_limit,
    createdAt: new Date(doc.created_at),
    updatedAt: new Date(doc.updated_at),
  });
  return doc;
}

export async function getOrg(orgId: string): Promise<OrgDoc | null> {
  const row = await Organization.findByPk(orgId);
  return row ? orgRowToDoc(row) : null;
}

export async function getOrgBySlug(slug: string): Promise<OrgDoc | null> {
  const row = await Organization.findOne({ where: { slug } });
  return row ? orgRowToDoc(row) : null;
}

export async function updateOrg(orgId: string, updates: Partial<OrgDoc>): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.name !== undefined) patch.name = updates.name;
  if (updates.slug !== undefined) patch.slug = updates.slug;
  if (updates.plan !== undefined) patch.plan = updates.plan;
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.settings !== undefined) patch.settings = updates.settings;
  if (updates.invoice_limit !== undefined) patch.invoiceLimit = updates.invoice_limit;
  await Organization.update(patch, { where: { orgId } });
}

export async function deleteOrg(orgId: string): Promise<void> {
  await Organization.destroy({ where: { orgId } });
}

// ─── OrgMember CRUD ─────────────────────────────────────────────────────────

export async function addMember(doc: OrgMemberDoc): Promise<OrgMemberDoc> {
  await OrgMember.create({
    orgId: doc.org_id,
    userId: doc.user_id,
    orgRole: doc.org_role,
    joinedAt: new Date(doc.joined_at),
  });
  return doc;
}

export async function getMembership(userId: string): Promise<OrgMemberDoc | null> {
  const row = await OrgMember.findOne({ where: { userId } });
  return row ? memberRowToDoc(row) : null;
}

export async function getMembersOfOrg(orgId: string): Promise<OrgMemberDoc[]> {
  const rows = await OrgMember.findAll({
    where: { orgId },
    include: [{ model: User, as: 'user', attributes: ['name', 'email'], required: false }],
  });
  return rows.map((row) => {
    const doc = memberRowToDoc(row);
    const u = (row as any).user;
    if (u) { doc.user_name = u.name; doc.user_email = u.email; }
    return doc;
  });
}

export async function updateMemberRole(orgId: string, userId: string, role: OrgRole): Promise<void> {
  await OrgMember.update({ orgRole: role }, { where: { orgId, userId } });
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  await OrgMember.destroy({ where: { orgId, userId } });
}

export async function countMembers(orgId: string): Promise<number> {
  return OrgMember.count({ where: { orgId } });
}

/** List all organizations (super admin only). */
export async function listAllOrgs(): Promise<OrgDoc[]> {
  const rows = await Organization.findAll({ order: [['createdAt', 'DESC']] });
  return rows.map(orgRowToDoc);
}
