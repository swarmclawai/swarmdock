import { asc, eq, count } from 'drizzle-orm';
import { db } from '../db/client.js';
import { eventOutbox } from '../db/schema.js';

export const OUTBOX_STATUS = {
  PENDING: 'pending',
  PUBLISHED: 'published',
} as const;

export const OUTBOX_TARGET = {
  AGENT: 'agent',
  BROADCAST: 'broadcast',
} as const;

export type OutboxTarget = (typeof OUTBOX_TARGET)[keyof typeof OUTBOX_TARGET];

export type EventEnvelope = {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
  originInstanceId: string;
  target?: OutboxTarget;
  agentId?: string | null;
  outboxId?: string;
};

function normalizeToggle(value: string | undefined): boolean | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return null;
}

export function isOutboxEnabled(): boolean {
  const override = normalizeToggle(process.env.ENABLE_EVENT_OUTBOX);
  if (override !== null) {
    return override;
  }

  return !process.execArgv.includes('--test') && !process.argv.includes('--test');
}

export async function enqueueOutboxEvent(params: {
  subject: string;
  target: OutboxTarget;
  agentId?: string | null;
  type: string;
  envelope: EventEnvelope;
}) {
  if (!isOutboxEnabled()) {
    return null;
  }

  const [row] = await db.insert(eventOutbox).values({
    subject: params.subject,
    target: params.target,
    agentId: params.agentId ?? null,
    eventType: params.type,
    payload: params.envelope,
    status: OUTBOX_STATUS.PENDING,
  }).returning();

  return row;
}

export async function listPendingOutbox(limit = 100) {
  if (!isOutboxEnabled()) {
    return [];
  }

  return db
    .select()
    .from(eventOutbox)
    .where(eq(eventOutbox.status, OUTBOX_STATUS.PENDING))
    .orderBy(asc(eventOutbox.createdAt))
    .limit(limit);
}

export async function markOutboxPublished(id: string) {
  if (!isOutboxEnabled()) {
    return;
  }

  await db.update(eventOutbox).set({
    status: OUTBOX_STATUS.PUBLISHED,
    publishedAt: new Date(),
    updatedAt: new Date(),
    lastError: null,
  }).where(eq(eventOutbox.id, id));
}

export async function markOutboxFailed(id: string, error: unknown) {
  if (!isOutboxEnabled()) {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  const [row] = await db.select().from(eventOutbox).where(eq(eventOutbox.id, id)).limit(1);
  const attempts = typeof row?.attempts === 'number' ? row.attempts + 1 : 1;

  await db.update(eventOutbox).set({
    attempts,
    lastError: message,
    updatedAt: new Date(),
  }).where(eq(eventOutbox.id, id));
}

export async function getPendingOutboxCount() {
  if (!isOutboxEnabled()) {
    return 0;
  }

  const [result] = await db.select({ total: count() }).from(eventOutbox).where(eq(eventOutbox.status, OUTBOX_STATUS.PENDING));
  return Number(result?.total ?? 0);
}
