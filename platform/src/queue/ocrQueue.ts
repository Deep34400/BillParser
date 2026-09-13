/**
 * pg-boss OCR job queue — durable background processing for invoice OCR.
 */
import PgBoss from 'pg-boss';
import { env } from '../config/env.js';
import { updateBillStatus } from '../ocr/repository.js';
import { recordActivity } from '../ocr/service/recordActivity.js';
import { processOcrJob, type OcrJobData } from './ocrWorker.js';

export const OCR_QUEUE_NAME = 'ocr-processing';
const WORKER_CONCURRENCY = 3;

const JOB_OPTIONS = {
  retryLimit: 3,
  retryDelay: 30,
  expireInMinutes: 10,
} as const;

let boss: PgBoss | null = null;
let initialized = false;

export function isQueueInitialized(): boolean {
  return initialized && boss !== null;
}

export function getQueueInstance(): PgBoss | null {
  return boss;
}

async function handleOcrJobs(jobs: PgBoss.JobWithMetadata<OcrJobData>[]): Promise<void> {
  for (const job of jobs) {
    try {
      await processOcrJob(job.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const attempt = job.retryCount + 1;
      const maxAttempts = job.retryLimit + 1;
      console.error(`[OCR] ${job.data.billId} — attempt ${attempt}/${maxAttempts} failed:`, msg);

      if (job.retryCount >= job.retryLimit) {
        await updateBillStatus(job.data.billId, 'FAILED', { processing_status: msg }).catch(() => {});
        recordActivity(job.data.userId, 'invoice:fail', 'invoice.failed', job.data.billId, {
          fileName: job.data.fileName,
          error: msg,
        });
      }
      throw err;
    }
  }
}

/** Start pg-boss and register OCR workers. */
export async function initQueue(): Promise<void> {
  if (initialized) return;

  boss = new PgBoss({ connectionString: env.databaseUrl });
  boss.on('error', (err) => console.error('[queue] pg-boss error:', err));

  await boss.start();
  await boss.createQueue(OCR_QUEUE_NAME, { name: OCR_QUEUE_NAME, ...JOB_OPTIONS });

  const workOptions = { includeMetadata: true as const };

  for (let i = 0; i < WORKER_CONCURRENCY; i++) {
    await boss.work(OCR_QUEUE_NAME, workOptions, handleOcrJobs);
  }

  initialized = true;
  console.log(`[queue] OCR queue started (concurrency=${WORKER_CONCURRENCY})`);
}

/** Gracefully stop pg-boss workers. */
export async function stopQueue(): Promise<void> {
  if (!boss) return;
  await boss.stop({ graceful: true, timeout: 30_000 });
  boss = null;
  initialized = false;
  console.log('[queue] OCR queue stopped');
}

/** Enqueue an OCR job for background processing. */
export async function enqueueOcr(jobData: OcrJobData): Promise<string | null> {
  if (!boss || !initialized) {
    throw new Error('OCR queue is not initialized');
  }
  const jobId = await boss.send(OCR_QUEUE_NAME, jobData, { ...JOB_OPTIONS });
  console.log(`[queue] Enqueued OCR job ${jobId} for bill ${jobData.billId}`);
  return jobId;
}
