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
import { WEBHOOK_EVENTS, type WebhookEvent } from './models/index.js';
import { NotFoundError, ValidationError } from '../shared/errors.js';
import { audit } from '../audit/service.js';

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

// ─── Event Dispatch ─────────────────────────────────────────────────────────

/**
 * Dispatch a webhook event to all subscribed endpoints.
 * Fire-and-forget — failures are logged but never block the caller.
 */
export function dispatchWebhookEvent(
  userId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): void {
  findActiveWebhooksForEvent(userId, event)
    .then((endpoints) => {
      for (const ep of endpoints) {
        sendWebhook(ep, event, payload).catch((err) => {
          console.error(`[webhook] Failed to deliver ${event} to ${ep.url}:`, err);
        });
      }
    })
    .catch((err) => {
      console.error(`[webhook] Failed to find endpoints for ${event}:`, err);
    });
}

async function sendWebhook(
  endpoint: WebhookEndpointDoc,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const body = JSON.stringify({
    id: uuid(),
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  const signature = createHmac('sha256', endpoint.secret)
    .update(body)
    .digest('hex');

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

    if (!res.ok) {
      console.warn(`[webhook] ${endpoint.url} returned ${res.status} for ${event}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}
