/**
 * Rate Limiting Middleware — per-user request throttling.
 *
 * Uses an in-memory sliding window counter. Each user gets a bucket
 * keyed by user_id. Limits are based on the organization plan.
 *
 * Plan limits (requests per minute):
 *   free:       30
 *   starter:    120
 *   business:   300
 *   enterprise: 1000
 *   (no plan):  60  (legacy/no-org users)
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface BucketEntry {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const buckets = new Map<string, BucketEntry>();

const PLAN_LIMITS: Record<string, number> = {
  free: 30,
  starter: 120,
  business: 300,
  enterprise: 1000,
};

const DEFAULT_LIMIT = 60;

function getLimit(req: FastifyRequest): number {
  const plan = (req as any).orgPlan;
  if (plan && PLAN_LIMITS[plan]) return PLAN_LIMITS[plan];
  return DEFAULT_LIMIT;
}

function getKey(req: FastifyRequest): string | null {
  const user = req.appUser;
  if (!user) return null;
  return `rate:${user.user_id}`;
}

/** Clean expired buckets every 5 minutes. */
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}, 5 * 60_000);

export async function rateLimitPlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const key = getKey(req);
    if (!key) return;

    const now = Date.now();
    const limit = getLimit(req);

    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + WINDOW_MS };
      buckets.set(key, bucket);
    }

    bucket.count += 1;

    reply.header('X-RateLimit-Limit', String(limit));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    reply.header('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > limit) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      reply.header('Retry-After', String(retryAfter));
      return reply.status(429).send({
        success: false,
        message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
      });
    }
  });
}
