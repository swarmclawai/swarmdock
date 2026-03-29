import { createHash } from 'crypto';
import { db } from '../db/client.js';
import { auditLog } from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';
import type { AuditLogEntry } from '@swarmdock/shared';

/**
 * Compute a SHA-256 hash for an audit log entry.
 */
function computeHash(
  previousHash: string,
  payload: unknown,
  eventType: string,
  timestamp: string,
): string {
  const data = previousHash + JSON.stringify(payload) + eventType + timestamp;
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Append an entry to the immutable hash-chained audit log.
 *
 * Each entry's hash is derived from the previous entry's hash plus the current
 * entry's payload, event type, and timestamp, forming a tamper-evident chain.
 */
export async function appendAuditLog(entry: {
  eventType: string;
  actorId?: string | null;
  targetId?: string | null;
  targetType?: string | null;
  payload: unknown;
}): Promise<AuditLogEntry> {
  // Fetch the most recent audit log entry to get its hash
  const [lastEntry] = await db
    .select({ hash: auditLog.hash })
    .from(auditLog)
    .orderBy(desc(auditLog.id))
    .limit(1);

  const previousHash = lastEntry?.hash ?? 'genesis';
  const timestamp = new Date();
  const hash = computeHash(
    previousHash,
    entry.payload,
    entry.eventType,
    timestamp.toISOString(),
  );

  const [created] = await db
    .insert(auditLog)
    .values({
      eventType: entry.eventType,
      actorId: entry.actorId ?? null,
      targetId: entry.targetId ?? null,
      targetType: entry.targetType ?? null,
      payload: entry.payload,
      hash,
      previousHash,
      timestamp,
    })
    .returning();

  return {
    id: created.id,
    timestamp: created.timestamp.toISOString(),
    eventType: created.eventType,
    actorId: created.actorId,
    targetId: created.targetId,
    targetType: created.targetType,
    payload: created.payload,
    hash: created.hash,
    previousHash: created.previousHash,
  };
}

/**
 * Verify the integrity of the audit log hash chain.
 *
 * Walks the chain in order and recomputes each hash to detect tampering.
 */
export async function verifyAuditChain(
  limit?: number,
): Promise<{ valid: boolean; entriesChecked: number; firstInvalidId?: number }> {
  const query = db
    .select()
    .from(auditLog)
    .orderBy(auditLog.id);

  const entries = limit
    ? await query.limit(limit)
    : await query;

  if (entries.length === 0) {
    return { valid: true, entriesChecked: 0 };
  }

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const expectedPreviousHash = i === 0 ? 'genesis' : entries[i - 1].hash;

    // Verify the previous hash pointer
    if (entry.previousHash !== expectedPreviousHash) {
      return { valid: false, entriesChecked: i + 1, firstInvalidId: entry.id };
    }

    // Recompute and verify the entry's hash
    const recomputedHash = computeHash(
      entry.previousHash ?? 'genesis',
      entry.payload,
      entry.eventType,
      entry.timestamp.toISOString(),
    );

    if (entry.hash !== recomputedHash) {
      return { valid: false, entriesChecked: i + 1, firstInvalidId: entry.id };
    }
  }

  return { valid: true, entriesChecked: entries.length };
}

let auditFailureCount = 0;

/** Returns the number of audit log append failures since process start */
export function getAuditFailureCount(): number {
  return auditFailureCount;
}

/**
 * Safe wrapper around appendAuditLog that tracks failures instead of
 * silently swallowing them. Use this for fire-and-forget audit calls
 * where a failure should not block the request but must be observable.
 */
export async function safeAppendAuditLog(entry: Parameters<typeof appendAuditLog>[0]): Promise<void> {
  try {
    await appendAuditLog(entry);
  } catch (err) {
    auditFailureCount++;
    console.error(`[AUDIT] CHAIN INTEGRITY RISK: failed to append ${entry.eventType} (failure #${auditFailureCount}):`, err);
  }
}

/**
 * Query the audit log with optional filters.
 */
export async function getAuditLog(filters: {
  eventType?: string;
  actorId?: string;
  targetId?: string;
  limit?: number;
  offset?: number;
}): Promise<AuditLogEntry[]> {
  const conditions: ReturnType<typeof eq>[] = [];

  if (filters.eventType) {
    conditions.push(eq(auditLog.eventType, filters.eventType));
  }
  if (filters.actorId) {
    conditions.push(eq(auditLog.actorId, filters.actorId));
  }
  if (filters.targetId) {
    conditions.push(eq(auditLog.targetId, filters.targetId));
  }

  let query = db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.timestamp))
    .$dynamic();

  if (conditions.length > 0) {
    const { and } = await import('drizzle-orm');
    query = query.where(and(...conditions));
  }

  if (filters.limit) {
    query = query.limit(filters.limit);
  }
  if (filters.offset) {
    query = query.offset(filters.offset);
  }

  const rows = await query;

  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp.toISOString(),
    eventType: row.eventType,
    actorId: row.actorId,
    targetId: row.targetId,
    targetType: row.targetType,
    payload: row.payload,
    hash: row.hash,
    previousHash: row.previousHash,
  }));
}
