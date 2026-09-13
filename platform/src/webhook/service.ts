/**
 * Webhook Service — manages webhook endpoints and dispatches events.
 *
 * When an event fires (e.g. invoice completed), this service finds all
 * active endpoints subscribed to that event and sends a signed POST request.
 *
 * Usage:
 *   import { dispatchWebhookEvent } from '../webhook/service.js';
 *   dispatchWebhookEvent(userId, 'invoice.completed', { billId, status: 'OCR_COMPLETED' });
 */
import { v4 as uuid } from 'uuid';
import { createHmac } from 'crypto';
import { Op } from 'sequelize';
import {
  createWebhook, listWebhooks, getWebhook, updateWebhook, deleteWebhook,
  findActiveWebhooksForEvent,
  type WebhookEndpointDoc,
} from './repository.js';
import { WEBHOOK_EVENTS, WebhookDelivery, type WebhookEvent } from './models/index.js';
import { WebhookEndpoint } from './models/webhookEndpoint.js';
import { User } from '../users/models/user.js';
import { NotFoundError, ValidationError } from '../shared/errors.js';
import { audit } from '../audit/service.js';

/** Delays before each attempt: immediate, 10s, 30s. */
const RETRY_DELAYS_MS = [0, 10_000, 30_000] as const;
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

function isAllowedWebhookUrl(url: string): boolean {
  if (url.startsWith('https://')) return true;
  return url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
}

// ─── Endpoint CRUD ──────────────────────────────────────────────────────────

export async function createEndpoint(
  userId: string,
  url: string,
  events: string[],
  description?: string,
): Promise<WebhookEndpointDoc> {
  if (!url || !isAllowedWebhookUrl(url)) {
    throw new ValidationError('Webhook URL must be https:// (or http://localhost for local testing)');
  }
  const invalidEvents = events.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (invalidEvents.length > 0) {
    throw new ValidationError(`Invalid webhook events: ${invalidEvents.join(', ')}`);
  }

  const secret = `whsec_${uuid().replace(/-/g, '')}`;
  const now = new Date().toISOString();
  const endpointId = uuid();

  const endpoint = await createWebhook({
    endpoint_id: endpointId,
    user_id: userId,
    url,
    events,
    secret,
    active: true,
    description: description ?? null,
    created_at: now,
    updated_at: now,
  });
  audit('webhook:create', { userId, resourceType: 'webhook', resourceId: endpointId, details: { url, events } });
  return endpoint;
}

export async function listEndpoints(userId: string): Promise<WebhookEndpointDoc[]> {
  return listWebhooks(userId);
}

export async function toggleEndpoint(endpointId: string, userId: string, active: boolean): Promise<void> {
  const ep = await getWebhook(endpointId);
  if (!ep || ep.user_id !== userId) throw new NotFoundError('Webhook endpoint', endpointId);
  await updateWebhook(endpointId, { active });
  audit('webhook:update', { userId, resourceType: 'webhook', resourceId: endpointId, details: { active } });
  if (active) replayFailedDeliveries(ep);
}

export async function adminToggleEndpoint(endpointId: string, adminUserId: string, active: boolean): Promise<void> {
  const ep = await getWebhook(endpointId);
  if (!ep) throw new NotFoundError('Webhook endpoint', endpointId);
  await updateWebhook(endpointId, { active });
  audit('webhook:update', {
    userId: adminUserId,
    resourceType: 'webhook',
    resourceId: endpointId,
    details: { active, admin: true, ownerUserId: ep.user_id },
  });
  if (active) replayFailedDeliveries({ ...ep, active: true });
}

export async function removeEndpoint(endpointId: string, userId: string): Promise<void> {
  const ep = await getWebhook(endpointId);
  if (!ep || ep.user_id !== userId) throw new NotFoundError('Webhook endpoint', endpointId);
  await deleteWebhook(endpointId);
  audit('webhook:delete', { userId, resourceType: 'webhook', resourceId: endpointId, details: { url: ep.url } });
}

// ─── Delivery log ───────────────────────────────────────────────────────────

export async function getDeliveryLog(endpointId: string, limit = 50) {
  const rows = await WebhookDelivery.findAll({
    where: { endpointId },
    order: [['createdAt', 'DESC']],
    limit: Math.min(Math.max(limit, 1), 200),
  });
  return rows.map((row) => ({
    id: row.id,
    endpoint_id: row.endpointId,
    event: row.event,
    payload: row.payload,
    status_code: row.statusCode,
    response_body: row.responseBody,
    attempt: row.attempt,
    success: row.success,
    error: row.error,
    created_at: row.createdAt.toISOString(),
  }));
}

function payloadData(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  const raw = payload as { data?: Record<string, unknown>; id?: string };
  return raw.data ?? (raw as Record<string, unknown>);
}

function deliveryGroupKey(endpointId: string, event: string, payload: unknown): string {
  const data = payloadData(payload);
  const billId = typeof data.billId === 'string' ? data.billId : '';
  const envelopeId = payload && typeof payload === 'object' ? String((payload as { id?: string }).id ?? '') : '';
  return `${endpointId}:${event}:${billId || envelopeId}`;
}

async function loadUserMap(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map<string, { email: string; name: string }>();
  const rows = await User.findAll({
    where: { userId: { [Op.in]: ids } },
    attributes: ['userId', 'email', 'name'],
  });
  return new Map(rows.map((u) => [u.userId, { email: u.email, name: u.name }]));
}

/** Replay events that never succeeded for this endpoint (used when it is enabled again). */
export function replayFailedDeliveries(endpoint: WebhookEndpointDoc): void {
  WebhookDelivery.findAll({
    where: { endpointId: endpoint.endpoint_id },
    order: [['createdAt', 'DESC']],
    limit: 400,
  })
    .then((rows) => {
      const succeeded = new Set<string>();
      const pending = new Map<string, { event: WebhookEvent; data: Record<string, unknown> }>();
      for (const row of rows) {
        const key = deliveryGroupKey(row.endpointId, row.event, row.payload);
        if (row.success) {
          succeeded.add(key);
          pending.delete(key);
          continue;
        }
        if (succeeded.has(key) || pending.has(key)) continue;
        pending.set(key, { event: row.event as WebhookEvent, data: payloadData(row.payload) });
      }
      for (const item of pending.values()) {
        scheduleWebhookDelivery(endpoint, item.event, item.data);
      }
    })
    .catch((err) => {
      console.error(`[webhook] Failed to replay deliveries for ${endpoint.url}:`, err);
    });
}

// ─── Admin delivery queries ─────────────────────────────────────────────────

export async function getAdminDeliveryLog(limit = 100) {
  const rows = await WebhookDelivery.findAll({
    order: [['createdAt', 'DESC']],
    limit: Math.min(Math.max(limit, 1), 500),
  });

  const epIds = [...new Set(rows.map((r) => r.endpointId))];
  const endpoints = epIds.length > 0
    ? await WebhookEndpoint.findAll({
        where: { endpointId: { [Op.in]: epIds } },
        attributes: ['endpointId', 'url', 'active', 'userId'],
      })
    : [];
  const epMap = new Map(endpoints.map((e) => [e.endpointId, { url: e.url, active: e.active, userId: e.userId }]));
  const userMap = await loadUserMap(endpoints.map((e) => e.userId));

  const successfulKeys = new Set<string>();
  for (const row of rows) {
    if (row.success) successfulKeys.add(deliveryGroupKey(row.endpointId, row.event, row.payload));
  }

  return rows.map((row) => {
    const data = payloadData(row.payload);
    const epInfo = epMap.get(row.endpointId);
    const user = epInfo ? userMap.get(epInfo.userId) : undefined;
    const key = deliveryGroupKey(row.endpointId, row.event, row.payload);

    return {
      id: row.id,
      endpoint_id: row.endpointId,
      endpoint_url: epInfo?.url ?? '(deleted)',
      endpoint_active: epInfo?.active ?? false,
      user_id: epInfo?.userId ?? null,
      user_email: user?.email ?? null,
      user_name: user?.name ?? null,
      event: row.event,
      bill_id: typeof data.billId === 'string' ? data.billId : null,
      file_name: typeof data.fileName === 'string' ? data.fileName : null,
      payload: data,
      status_code: row.statusCode,
      attempt: row.attempt,
      success: row.success,
      error: row.error,
      retryable: !row.success && !successfulKeys.has(key),
      created_at: row.createdAt.toISOString(),
    };
  });
}

export async function getAdminDeliveryStats() {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const rows = await WebhookDelivery.findAll({
    attributes: [
      [WebhookDelivery.sequelize!.fn('DATE', WebhookDelivery.sequelize!.col('created_at')), 'day'],
      [WebhookDelivery.sequelize!.fn('SUM', WebhookDelivery.sequelize!.literal('CASE WHEN success = true THEN 1 ELSE 0 END')), 'ok'],
      [WebhookDelivery.sequelize!.fn('SUM', WebhookDelivery.sequelize!.literal('CASE WHEN success = false THEN 1 ELSE 0 END')), 'fail'],
      [WebhookDelivery.sequelize!.fn('COUNT', WebhookDelivery.sequelize!.col('id')), 'total'],
    ],
    where: { createdAt: { [Op.gte]: since } },
    group: [WebhookDelivery.sequelize!.fn('DATE', WebhookDelivery.sequelize!.col('created_at'))],
    order: [[WebhookDelivery.sequelize!.fn('DATE', WebhookDelivery.sequelize!.col('created_at')), 'ASC']],
    raw: true,
  });

  const totalOk = rows.reduce((s, r: any) => s + Number(r.ok), 0);
  const totalFail = rows.reduce((s, r: any) => s + Number(r.fail), 0);

  const allEndpoints = await WebhookEndpoint.findAll({
    attributes: ['endpointId', 'url', 'events', 'active', 'userId', 'description'],
    order: [['updatedAt', 'DESC']],
  });
  const userMap = await loadUserMap(allEndpoints.map((e) => e.userId));

  const recent = await WebhookDelivery.findAll({
    attributes: ['endpointId', 'success', 'attempt', 'error', 'event', 'payload', 'createdAt'],
    order: [['createdAt', 'DESC']],
    limit: 800,
  });

  const succeeded = new Set<string>();
  const failedPending = new Map<string, number>();
  const lastError = new Map<string, string>();
  const lastFailAttempt = new Map<string, number>();
  for (const row of recent) {
    const key = deliveryGroupKey(row.endpointId, row.event, row.payload);
    if (row.success) {
      succeeded.add(key);
      continue;
    }
    if (!lastError.has(row.endpointId) && row.error) lastError.set(row.endpointId, row.error);
    lastFailAttempt.set(row.endpointId, Math.max(lastFailAttempt.get(row.endpointId) ?? 0, row.attempt));
    if (!succeeded.has(key)) {
      succeeded.add(key);
      failedPending.set(row.endpointId, (failedPending.get(row.endpointId) ?? 0) + 1);
    }
  }

  const endpoints = allEndpoints.map((e) => {
    const user = userMap.get(e.userId);
    const pending = failedPending.get(e.endpointId) ?? 0;
    const autoPaused = !e.active && (lastFailAttempt.get(e.endpointId) ?? 0) >= MAX_ATTEMPTS;
    return {
      id: e.endpointId,
      url: e.url,
      events: e.events,
      active: e.active,
      user_id: e.userId,
      user_email: user?.email ?? null,
      user_name: user?.name ?? null,
      failed_pending: pending,
      last_error: lastError.get(e.endpointId) ?? null,
      auto_paused: autoPaused,
    };
  });

  return {
    daily: rows.map((r: any) => ({ day: r.day, ok: Number(r.ok), fail: Number(r.fail) })),
    totalOk,
    totalFail,
    successRate: totalOk + totalFail > 0 ? Math.round((totalOk / (totalOk + totalFail)) * 100) : 100,
    endpoints,
    activeEndpoints: endpoints.filter((e) => e.active).length,
    totalEndpoints: endpoints.length,
  };
}

export async function retryDelivery(deliveryId: string) {
  const delivery = await WebhookDelivery.findByPk(deliveryId);
  if (!delivery) throw new NotFoundError('Webhook delivery', deliveryId);
  if (delivery.success) throw new ValidationError('Delivery already succeeded');

  const ep = await getWebhook(delivery.endpointId);
  if (!ep) throw new NotFoundError('Webhook endpoint', delivery.endpointId);
  if (!ep.active) throw new ValidationError('Enable the webhook before retrying deliveries');

  const payload = typeof delivery.payload === 'string' ? JSON.parse(delivery.payload) : delivery.payload;
  const envelopeId = payload && typeof payload === 'object' ? (payload as { id?: string }).id : undefined;
  scheduleWebhookDelivery(ep, delivery.event as WebhookEvent, payloadData(payload), 1, envelopeId);
}

// ─── Event Dispatch ─────────────────────────────────────────────────────────

/**
 * Dispatch a webhook event to all subscribed endpoints.
 * Fire-and-forget — failures are logged and retried but never block the caller.
 */
export function dispatchWebhookEvent(
  userId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): void {
  findActiveWebhooksForEvent(userId, event)
    .then((endpoints) => {
      for (const ep of endpoints) {
        scheduleWebhookDelivery(ep, event, payload);
      }
    })
    .catch((err) => {
      console.error(`[webhook] Failed to find endpoints for ${event}:`, err);
    });
}

interface DeliveryAttemptResult {
  success: boolean;
  statusCode: number | null;
  responseBody: string | null;
  error: string | null;
}

function scheduleWebhookDelivery(
  endpoint: WebhookEndpointDoc,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  attempt = 1,
  envelopeId?: string,
): void {
  const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? 0;
  const id = envelopeId ?? uuid();

  setTimeout(() => {
    executeDeliveryAttempt(endpoint, event, payload, attempt, id)
      .then(async (result) => {
        if (result.success) return;
        if (attempt < MAX_ATTEMPTS) {
          scheduleWebhookDelivery(endpoint, event, payload, attempt + 1, id);
          return;
        }
        await pauseEndpointAfterRetries(endpoint);
      })
      .catch((err) => {
        console.error(`[webhook] Failed to deliver ${event} to ${endpoint.url} (attempt ${attempt}):`, err);
      });
  }, delayMs);
}

async function pauseEndpointAfterRetries(endpoint: WebhookEndpointDoc): Promise<void> {
  try {
    await updateWebhook(endpoint.endpoint_id, { active: false });
    audit('webhook:update', {
      userId: endpoint.user_id,
      resourceType: 'webhook',
      resourceId: endpoint.endpoint_id,
      details: { active: false, reason: 'auto_paused_after_retries' },
    });
    console.warn(`[webhook] Auto-paused ${endpoint.url} after ${MAX_ATTEMPTS} failed attempts`);
  } catch (err) {
    console.error(`[webhook] Failed to auto-pause ${endpoint.url}:`, err);
  }
}

async function executeDeliveryAttempt(
  endpoint: WebhookEndpointDoc,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  attempt: number,
  envelopeId: string,
): Promise<DeliveryAttemptResult> {
  const envelope = {
    id: envelopeId,
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  };
  const body = JSON.stringify(envelope);

  const signature = createHmac('sha256', endpoint.secret)
    .update(body)
    .digest('hex');

  let result: DeliveryAttemptResult;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': `sha256=${signature}`,
        'X-Webhook-Event': event,
      },
      body,
      signal: controller.signal,
    });

    let responseBody: string | null = null;
    try {
      if (typeof res.text === 'function') {
        const text = await res.text();
        responseBody = text ? text.slice(0, 4096) : null;
      }
    } catch {
      // Response body unreadable — still record status code.
    }
    const success = res.ok;

    if (!success) {
      console.warn(`[webhook] ${endpoint.url} returned ${res.status} for ${event} (attempt ${attempt})`);
    }

    result = {
      success,
      statusCode: res.status,
      responseBody: responseBody ? responseBody.slice(0, 4096) : null,
      error: success ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[webhook] ${endpoint.url} delivery failed for ${event} (attempt ${attempt}): ${msg}`);
    result = {
      success: false,
      statusCode: null,
      responseBody: null,
      error: msg,
    };
  } finally {
    clearTimeout(timeout);
  }

  try {
    await WebhookDelivery.create({
      id: uuid(),
      endpointId: endpoint.endpoint_id,
      event,
      payload: envelope,
      statusCode: result.statusCode,
      responseBody: result.responseBody,
      attempt,
      success: result.success,
      error: result.error,
      createdAt: new Date(),
    });
  } catch (logErr) {
    console.error(`[webhook] Failed to log delivery for ${endpoint.url}:`, logErr);
  }

  return result;
}
