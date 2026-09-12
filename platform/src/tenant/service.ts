/**
 * Tenant Service — business logic for organization management.
 *
 * Handles org creation, member invites, role changes, and org settings.
 * No HTTP concerns — receives typed params, returns typed results.
 */
import { v4 as uuid } from 'uuid';
import {
  createOrg, getOrg, getOrgBySlug, updateOrg, deleteOrg,
  addMember, getMembership, getMembersOfOrg, updateMemberRole, removeMember,
  countMembers,
  type OrgDoc, type OrgMemberDoc,
} from './repository.js';
import type { OrgRole } from './models/index.js';
import { NotFoundError, ValidationError, ForbiddenError } from '../shared/errors.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Turn an org name into a URL-safe slug. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

/** Plan limits for invoice count per month. */
const PLAN_LIMITS: Record<string, number> = {
  free: 50,
  starter: 500,
  business: 5000,
  enterprise: 999_999,
};

// ─── Organization CRUD ──────────────────────────────────────────────────────

/**
 * Create a new organization and make the creator the owner.
 * Called during signup or when an existing user creates their first org.
 */
export async function createOrganization(
  name: string,
  ownerUserId: string,
): Promise<OrgDoc> {
  if (!name || name.trim().length < 2) {
    throw new ValidationError('Organization name must be at least 2 characters');
  }

  // Check if user already belongs to an org
  const existing = await getMembership(ownerUserId);
  if (existing) {
    throw new ValidationError('User already belongs to an organization');
  }

  let slug = slugify(name);
  const taken = await getOrgBySlug(slug);
  if (taken) slug = `${slug}-${uuid().slice(0, 6)}`;

  const now = new Date().toISOString();
  const org: OrgDoc = {
    org_id: uuid(),
    name: name.trim(),
    slug,
    plan: 'free',
    status: 'active',
    settings: null,
    invoice_limit: PLAN_LIMITS.free,
    created_at: now,
    updated_at: now,
  };

  await createOrg(org);

  // Make the creator the owner
  await addMember({
    org_id: org.org_id,
    user_id: ownerUserId,
    org_role: 'owner',
    joined_at: now,
  });

  return org;
}

/** Get an org by ID. Throws NotFoundError if missing. */
export async function getOrganization(orgId: string): Promise<OrgDoc> {
  const org = await getOrg(orgId);
  if (!org) throw new NotFoundError('Organization', orgId);
  return org;
}

/** Update org name or settings. Only owner/admin can do this. */
export async function updateOrganization(
  orgId: string,
  callerRole: OrgRole,
  updates: { name?: string; settings?: Record<string, unknown> },
): Promise<OrgDoc> {
  if (callerRole !== 'owner' && callerRole !== 'admin') {
    throw new ForbiddenError('Only owner or admin can update organization settings');
  }

  await getOrganization(orgId); // throws if not found

  const patch: Partial<OrgDoc> = {};
  if (updates.name) patch.name = updates.name.trim();
  if (updates.settings) patch.settings = updates.settings;

  await updateOrg(orgId, patch);
  return (await getOrg(orgId))!;
}

// ─── Member Management ──────────────────────────────────────────────────────

/** List all members of an organization. */
export async function listMembers(orgId: string): Promise<OrgMemberDoc[]> {
  return getMembersOfOrg(orgId);
}

/** Invite a user to an organization. */
export async function inviteMember(
  orgId: string,
  callerRole: OrgRole,
  userId: string,
  role: OrgRole = 'viewer',
): Promise<OrgMemberDoc> {
  if (callerRole !== 'owner' && callerRole !== 'admin') {
    throw new ForbiddenError('Only owner or admin can invite members');
  }

  // Can't assign a role higher than your own
  if (role === 'owner') {
    throw new ValidationError('Cannot invite someone as owner — transfer ownership instead');
  }
  if (role === 'admin' && callerRole !== 'owner') {
    throw new ForbiddenError('Only owner can assign admin role');
  }

  const existing = await getMembership(userId);
  if (existing) {
    throw new ValidationError('User already belongs to an organization');
  }

  const now = new Date().toISOString();
  const member: OrgMemberDoc = {
    org_id: orgId,
    user_id: userId,
    org_role: role,
    joined_at: now,
  };

  await addMember(member);
  return member;
}

/** Change a member's role within the org. */
export async function changeMemberRole(
  orgId: string,
  callerRole: OrgRole,
  targetUserId: string,
  newRole: OrgRole,
): Promise<void> {
  if (callerRole !== 'owner' && callerRole !== 'admin') {
    throw new ForbiddenError('Only owner or admin can change roles');
  }

  if (newRole === 'owner') {
    throw new ValidationError('Cannot assign owner role — use transfer ownership');
  }

  const target = await getMembership(targetUserId);
  if (!target || target.org_id !== orgId) {
    throw new NotFoundError('Member', targetUserId);
  }

  // Can't change the owner's role
  if (target.org_role === 'owner') {
    throw new ForbiddenError('Cannot change the owner\'s role');
  }

  // Admin can't promote to admin
  if (newRole === 'admin' && callerRole !== 'owner') {
    throw new ForbiddenError('Only owner can assign admin role');
  }

  await updateMemberRole(orgId, targetUserId, newRole);
}

/** Remove a member from the org. */
export async function removeOrgMember(
  orgId: string,
  callerRole: OrgRole,
  targetUserId: string,
): Promise<void> {
  if (callerRole !== 'owner' && callerRole !== 'admin') {
    throw new ForbiddenError('Only owner or admin can remove members');
  }

  const target = await getMembership(targetUserId);
  if (!target || target.org_id !== orgId) {
    throw new NotFoundError('Member', targetUserId);
  }

  if (target.org_role === 'owner') {
    throw new ForbiddenError('Cannot remove the org owner');
  }

  await removeMember(orgId, targetUserId);
}

/** Get the user's current org membership (or null). */
export async function getUserMembership(userId: string): Promise<OrgMemberDoc | null> {
  return getMembership(userId);
}
