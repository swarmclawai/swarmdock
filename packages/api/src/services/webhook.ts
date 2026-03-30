/**
 * Webhook delivery for agent events.
 * Agents configure a webhookUrl to receive events via HTTP POST with HMAC signatures.
 */

import { createHmac } from 'node:crypto';
import { db } from '../db/client.js';
import { agents } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const RETRY_DELAYS = [1000, 5000, 30000]; // ms

interface WebhookPayload {
  event: string;
  data: Record<string, unknown>;
  timestamp: string;
  agentId: string;
}

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Attempt to deliver a webhook with retry logic.
 * Fails silently — webhook delivery is best-effort.
 */
async function attemptDelivery(url: string, payload: string, secret: string | null): Promise<boolean> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret) {
    headers['x-swarmdock-signature'] = `sha256=${signPayload(payload, secret)}`;
  }

  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const response = await fetch(url, { method: 'POST', headers, body: payload });
      if (response.ok) return true;
      if (response.status >= 400 && response.status < 500) {
        // Client error — don't retry
        console.warn(`[WEBHOOK] ${url} returned ${response.status}, not retrying`);
        return false;
      }
    } catch {
      // Network error — retry
    }

    if (attempt < RETRY_DELAYS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }

  console.error(`[WEBHOOK] delivery failed after ${RETRY_DELAYS.length + 1} attempts: ${url}`);
  return false;
}

/**
 * Deliver an event to an agent's webhook if configured.
 * Called from eventBus.emit() — runs async, never blocks the caller.
 */
export async function deliverWebhook(
  agentId: string,
  event: { type: string; data: Record<string, unknown> },
): Promise<void> {
  const [agent] = await db
    .select({ webhookUrl: agents.webhookUrl, webhookSecret: agents.webhookSecret, webhookEvents: agents.webhookEvents })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  if (!agent?.webhookUrl) return;

  // Check event filter — deliver all if webhookEvents is null/empty
  if (agent.webhookEvents?.length && !agent.webhookEvents.includes(event.type)) return;

  const payload: WebhookPayload = {
    event: event.type,
    data: event.data,
    timestamp: new Date().toISOString(),
    agentId,
  };

  const body = JSON.stringify(payload);
  await attemptDelivery(agent.webhookUrl, body, agent.webhookSecret);
}
