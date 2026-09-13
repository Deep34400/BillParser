/**
 * Webhook Repository — CRUD for webhook endpoints.
 */
import { WebhookEndpoint } from './models/index.js';

export interface WebhookEndpointDoc {
  endpoint_id: string;
  user_id: string;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  description: string | null;
  created_at: string;
  updated_at: string;
}

function rowToDoc(row: WebhookEndpoint): WebhookEndpointDoc {
  return {
    endpoint_id: row.endpointId,
    user_id: row.userId,
    url: row.url,
    events: row.events,
    secret: row.secret,
    active: row.active,
    description: row.description,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

export async function createWebhook(doc: WebhookEndpointDoc): Promise<WebhookEndpointDoc> {
  await WebhookEndpoint.create({
    endpointId: doc.endpoint_id,
    userId: doc.user_id,
    url: doc.url,
    events: doc.events,
    secret: doc.secret,
    active: doc.active,
    description: doc.description,
    createdAt: new Date(doc.created_at),
    updatedAt: new Date(doc.updated_at),
  });
  return doc;
}

export async function listWebhooks(userId: string): Promise<WebhookEndpointDoc[]> {
  const rows = await WebhookEndpoint.findAll({ where: { userId }, order: [['createdAt', 'DESC']] });
  return rows.map(rowToDoc);
}

export async function getWebhook(endpointId: string): Promise<WebhookEndpointDoc | null> {
  const row = await WebhookEndpoint.findByPk(endpointId);
  return row ? rowToDoc(row) : null;
}

export async function updateWebhook(endpointId: string, updates: Partial<WebhookEndpointDoc>): Promise<void> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.url !== undefined) patch.url = updates.url;
  if (updates.events !== undefined) patch.events = updates.events;
  if (updates.active !== undefined) patch.active = updates.active;
  if (updates.description !== undefined) patch.description = updates.description;
  await WebhookEndpoint.update(patch, { where: { endpointId } });
}

export async function deleteWebhook(endpointId: string): Promise<void> {
  await WebhookEndpoint.destroy({ where: { endpointId } });
}

export async function findActiveWebhooksForEvent(userId: string, event: string): Promise<WebhookEndpointDoc[]> {
  const rows = await WebhookEndpoint.findAll({
    where: { userId, active: true },
  });
  return rows.filter((r) => r.events.includes(event)).map(rowToDoc);
}
