/**
 * Webhook Service — manages webhook endpoints and dispatches events.
 *
 * When an event fires (e.g. invoice completed), this service finds all
 * active endpoints subscribed to that event and sends a signed POST request.
 *
 * Usage:
 *   import { dispatchWebhookEvent } from '../webhook/service.js';
 *   dispatchWebhookEvent(orgId, 'invoice.completed', { billId, status: 'OCR_COMPLETED' });
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

// ─── Endpoint CRUD ──────────────────────────────────────────────────────────

export async function createEndpoint(
  orgId: string,
  url: string,
  events: string[],
  description?: string,
): Promise<WebhookEndpointDoc> {
  if (!url || !url.startsWith('https://')) {
    throw new ValidationError('Webhook URL must start with https://');
  }
  const invalidEvents = events.filter((e) => !(WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (invalidEvents.length > 0) {
    throw new ValidationError(`Invalid webhook events: ${invalidEvents.join(', ')}`);
  }

  const secret = `whsec_${uuid().replace(/-/g, '')}`;
  const now = new Date().toISOString();

  return createWebhook({
    endpoint_id: uuid(),
    org_id: orgId,
    url,
    events,
    secret,
    active: true,
    description: description ?? null,
    created_at: now,
    updated_at: now,
  });
}

export async function listEndpoints(orgId: string): Promise<WebhookEndpointDoc[]> {
  return listWebhooks(orgId);
}

export async function toggleEndpoint(endpointId: string, active: boolean): Promise<void> {
  const ep = await getWebhook(endpointId);
  if (!ep) throw new NotFoundError('Webhook endpoint', endpointId);
  await updateWebhook(endpointId, { active });
}

export async function removeEndpoint(endpointId: string): Promise<void> {
  const ep = await getWebhook(endpointId);
  if (!ep) throw new NotFoundError('Webhook endpoint', endpointId);
  await deleteWebhook(endpointId);
}

// ─── Event Dispatch ─────────────────────────────────────────────────────────

/**
 * Dispatch a webhook event to all subscribed endpoints.
 * Fire-and-forget — failures are logged but never block the caller.
 */
export function dispatchWebhookEvent(
  orgId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
): void {
  findActiveWebhooksForEvent(orgId, event)
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
