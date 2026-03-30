/**
 * Webhook delivery for agent events.
 * Agents configure a webhookUrl to receive events via HTTP POST with HMAC signatures.
 */

import { createHmac } from 'node:crypto';
import { db } from '../db/client.js';
import { agents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { redisGet, redisSet } from '../lib/redis.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger({ service: 'webhook' });
const RETRY_DELAYS = [1000, 5000, 30000]; // ms
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_SECONDS = 300; // 5 minutes

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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(url, { method: 'POST', headers, body: payload, signal: controller.signal });
      clearTimeout(timeout);
      if (response.ok) return true;
      if (response.status >= 400 && response.status < 500) {
        // Client error — don't retry
        logger.warn('client error, not retrying', { url, status: response.status });
        return false;
      }
    } catch {
      // Network error — retry
    }

    if (attempt < RETRY_DELAYS.length) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
    }
  }

  logger.error('delivery failed after retries', { url, attempts: RETRY_DELAYS.length + 1 });
  return false;
}

/** Check if the circuit breaker is open for an agent's webhook. */
async function isCircuitOpen(agentId: string): Promise<boolean> {
  const failures = await redisGet(`swarmdock:webhook:failures:${agentId}`);
  return failures !== null && parseInt(failures, 10) >= CIRCUIT_FAILURE_THRESHOLD;
}

/** Record a webhook delivery failure. Opens circuit after threshold. */
async function recordFailure(agentId: string): Promise<void> {
  const key = `swarmdock:webhook:failures:${agentId}`;
  const failures = await redisGet(key);
  const count = failures ? parseInt(failures, 10) + 1 : 1;
  await redisSet(key, String(count), CIRCUIT_COOLDOWN_SECONDS);
  if (count === CIRCUIT_FAILURE_THRESHOLD) {
    logger.warn('circuit breaker OPEN', { agentId, failures: count, cooldownSeconds: CIRCUIT_COOLDOWN_SECONDS });
  }
}

/** Reset the circuit breaker after a successful delivery. */
async function resetCircuit(agentId: string): Promise<void> {
  await redisSet(`swarmdock:webhook:failures:${agentId}`, '0', 1);
}

/**
 * Deliver an event to an agent's webhook if configured.
 * Called from eventBus.emit() — runs async, never blocks the caller.
 * Respects circuit breaker: skips delivery after repeated failures.
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

  // Circuit breaker — skip delivery if agent webhook is repeatedly failing
  if (await isCircuitOpen(agentId)) return;

  const payload: WebhookPayload = {
    event: event.type,
    data: event.data,
    timestamp: new Date().toISOString(),
    agentId,
  };

  const body = JSON.stringify(payload);
  const success = await attemptDelivery(agent.webhookUrl, body, agent.webhookSecret);

  if (success) {
    await resetCircuit(agentId);
  } else {
    await recordFailure(agentId);
  }
}
