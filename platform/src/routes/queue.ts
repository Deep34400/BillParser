import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/auth.js';
import {
  OCR_QUEUE_NAME,
  getQueueInstance,
  isQueueInitialized,
  listRecentJobs,
} from '../queue/ocrQueue.js';
import { User } from '../users/models/user.js';
import { Op } from 'sequelize';

export async function queueRoutes(app: FastifyInstance) {
  /**
   * GET /api/queue/stats — pg-boss OCR queue monitoring.
   * Returns pending, active, completed, failed, and expired counts.
   */
  app.get('/api/queue/stats', { preHandler: requireAdmin }, async () => {
    const boss = getQueueInstance();
    const empty = {
      initialized: false,
      queue: OCR_QUEUE_NAME,
      pending: 0,
      active: 0,
      completed: 0,
      failed: 0,
      expired: 0,
      concurrency: 3,
      jobs: [] as Array<Record<string, unknown>>,
    };

    if (!isQueueInitialized() || !boss) {
      return { success: true, data: empty };
    }

    const pending = await boss.getQueueSize(OCR_QUEUE_NAME);
    const inFlight = await boss.getQueueSize(OCR_QUEUE_NAME, { before: 'completed' });
    const active = Math.max(0, inFlight - pending);

    // Fetch completed/failed/expired from pg-boss job table directly
    let completed = 0;
    let failed = 0;
    let expired = 0;
    try {
      const db = (boss as any).db;
      if (db) {
        const sql = `
          SELECT state, count(*)::int AS cnt
          FROM pgboss.job
          WHERE name = $1 AND completedon > now() - interval '24 hours'
          GROUP BY state
        `;
        const rows: Array<{ state: string; cnt: number }> = await db.executeSql(sql, [OCR_QUEUE_NAME]).then((r: any) => r.rows ?? []);
        for (const r of rows) {
          if (r.state === 'completed') completed = r.cnt;
          else if (r.state === 'failed') failed = r.cnt;
          else if (r.state === 'expired') expired = r.cnt;
        }
      }
    } catch {
      // pg-boss internals may change — degrade gracefully
    }

    const jobs = await listRecentJobs(50);
    const userIds = [...new Set(jobs.map((j) => j.userId).filter((id): id is string => Boolean(id)))];
    const users = userIds.length > 0
      ? await User.findAll({ where: { userId: { [Op.in]: userIds } }, attributes: ['userId', 'email', 'name'] })
      : [];
    const userMap = new Map(users.map((u) => [u.userId, { email: u.email, name: u.name }]));

    return {
      success: true,
      data: {
        initialized: true,
        queue: OCR_QUEUE_NAME,
        pending,
        active,
        completed,
        failed,
        expired,
        concurrency: 3,
        jobs: jobs.map((job) => ({
          ...job,
          userEmail: job.userId ? userMap.get(job.userId)?.email ?? null : null,
          userName: job.userId ? userMap.get(job.userId)?.name ?? null : null,
        })),
      },
    };
  });
}
