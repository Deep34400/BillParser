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
import {
  createWebhook, listWebhooks, getWebhook, updateWebhook, deleteWebhook,
  findActiveWebhooksForEvent,
  type WebhookEndpointDoc,
} from './repository.js';
import { WEBHOOK_EVENTS, WebhookDelivery, type WebhookEvent } from './models/index.js';
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
): void {
  const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? 0;

  setTimeout(() => {
    executeDeliveryAttempt(endpoint, event, payload, attempt)
      .then((result) => {
        if (!result.success && attempt < MAX_ATTEMPTS) {
          scheduleWebhookDelivery(endpoint, event, payload, attempt + 1);
        }
      })
      .catch((err) => {
        console.error(`[webhook] Failed to deliver ${event} to ${endpoint.url} (attempt ${attempt}):`, err);
      });
  }, delayMs);
}

async function executeDeliveryAttempt(
  endpoint: WebhookEndpointDoc,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  attempt: number,
): Promise<DeliveryAttemptResult> {
  const envelope = {
    id: uuid(),
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
