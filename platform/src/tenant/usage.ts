/**
 * Usage Metering — tracks monthly invoice count per organization.
 *
 * Counts bills created in the current calendar month for the given org.
 * Used to enforce plan limits before allowing new uploads.
 */
import { Op } from 'sequelize';
import { Bill } from '../ocr/models/index.js';
import { getOrg } from './repository.js';
import { ForbiddenError } from '../shared/errors.js';

/** Get the current month's start and end dates. */
function currentMonthRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

/** Count how many bills were created this month for the given org. */
export async function getMonthlyUsage(orgId: string): Promise<number> {
  const { start, end } = currentMonthRange();
  return Bill.count({
    where: {
      orgId,
      createdAt: { [Op.gte]: start, [Op.lt]: end },
    },
  });
}

/** Get usage info for an org: current count, limit, and percentage. */
export async function getUsageInfo(orgId: string): Promise<{
  currentMonth: number;
  limit: number;
  percentage: number;
  remaining: number;
}> {
  const org = await getOrg(orgId);
  const limit = org?.invoice_limit ?? 50;
  const currentMonth = await getMonthlyUsage(orgId);
  const remaining = Math.max(0, limit - currentMonth);
  const percentage = limit > 0 ? Math.round((currentMonth / limit) * 100) : 0;
  return { currentMonth, limit, percentage, remaining };
}

/**
 * Check if an org has capacity for more uploads. Throws ForbiddenError if limit reached.
 * Call this before processing uploads.
 */
export async function enforceUsageLimit(orgId: string, uploadCount = 1): Promise<void> {
  const { currentMonth, limit, remaining } = await getUsageInfo(orgId);
  if (remaining < uploadCount) {
    throw new ForbiddenError(
      `Monthly invoice limit reached (${currentMonth}/${limit}). ` +
      `Upgrade your plan or wait until next month.`,
    );
  }
}
