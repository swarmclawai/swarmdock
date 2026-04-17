import { initTelemetry } from './lib/telemetry.js';
await initTelemetry();

import { indexAgentDocument, indexTaskDocument, isSearchEnabled, syncAllSearchIndexes } from './services/search.js';
import { listPendingOutbox, markOutboxFailed, markOutboxPublished } from './services/outbox.js';
import { isNatsConfigured, publishNatsEvent, toJetStreamSubject } from './lib/nats.js';
import { runAnomalyDetection } from './services/anomaly.js';
import { releaseEscrow, refundEscrow } from './services/escrow.js';
import { scoreMatchCandidates } from './services/matching.js';
import { runMcpIngestionBatch } from './services/mcp-registry-ingest.js';
import { workerIterationDuration } from './lib/metrics.js';
import { db } from './db/client.js';
import { agents, tasks, agentSkills, escrowTransactions, challenges } from './db/schema.js';
import { eq, and, lt, inArray, sql, ne, or } from 'drizzle-orm';
import { TASK_STATUS, AGENT_STATUS, MATCHING_MODE, ESCROW_STATUS } from '@swarmdock/shared';
import { eventBus } from './lib/events.js';
import { redisAcquireLock, redisReleaseLock } from './lib/redis.js';
import { createLogger } from './lib/logger.js';

const logger = createLogger({ service: 'worker' });

let shuttingDown = false;
const activeIntervals: ReturnType<typeof setInterval>[] = [];

function isWorkerEnabled(envVar: string, defaultValue = '1'): boolean {
  return (process.env[envVar] ?? defaultValue) === '1';
}

/** Run a worker function with advisory lock and OTel histogram. */
async function timedWorker(name: string, fn: () => Promise<unknown>, lockTtl = 30): Promise<void> {
  if (shuttingDown) return;
  const lockKey = `swarmdock:worker:${name}`;
  const token = await redisAcquireLock(lockKey, lockTtl);
  if (!token) return; // Another instance holds the lock
  const start = performance.now();
  try {
    await fn();
  } finally {
    workerIterationDuration.record(performance.now() - start, { worker: name });
    await redisReleaseLock(lockKey, token);
  }
}

function trackInterval(interval: ReturnType<typeof setInterval>): ReturnType<typeof setInterval> {
  activeIntervals.push(interval);
  return interval;
}

function collectIds(row: { agentId: string | null; payload: unknown }) {
  const payload = row.payload as Record<string, unknown>;
  const data = (payload.data ?? {}) as Record<string, unknown>;

  const taskIds = new Set<string>();
  const agentIds = new Set<string>();

  for (const value of [data.taskId]) {
    if (typeof value === 'string' && value.length > 0) {
      taskIds.add(value);
    }
  }

  for (const value of [data.agentId, data.bidderId, data.requesterId, data.assigneeId, row.agentId]) {
    if (typeof value === 'string' && value.length > 0) {
      agentIds.add(value);
    }
  }

  return { taskIds, agentIds };
}

async function processOutboxBatch() {
  const rows = await listPendingOutbox(100);
  for (const row of rows) {
    try {
      const envelope = {
        ...(row.payload as Record<string, unknown>),
        outboxId: row.id,
      };

      const subject = toJetStreamSubject(row.subject);
      const published = await publishNatsEvent(subject, envelope as never).catch(() => false);
      if (isNatsConfigured() && !published) {
        throw new Error(`NATS publish failed for outbox row ${row.id}`);
      }

      const { taskIds, agentIds } = collectIds(row);

      if (isSearchEnabled()) {
        await Promise.all([
          ...Array.from(taskIds).map((taskId) => indexTaskDocument(taskId)),
          ...Array.from(agentIds).map((agentId) => indexAgentDocument(agentId)),
        ]);
      }

      await markOutboxPublished(row.id);
    } catch (error) {
      await markOutboxFailed(row.id, error);
      logger.error('failed to process outbox row', { outboxId: row.id, error: String(error) });
    }
  }
}

async function processTaskExpiry() {
  const now = new Date();
  const expiredTasks = await db
    .select()
    .from(tasks)
    .where(
      and(
        inArray(tasks.status, [TASK_STATUS.OPEN, TASK_STATUS.BIDDING]),
        lt(tasks.deadline, now),
      ),
    );

  for (const task of expiredTasks) {
    await db
      .update(tasks)
      .set({ status: TASK_STATUS.EXPIRED, updatedAt: now })
      .where(eq(tasks.id, task.id));

    eventBus.broadcast({
      type: 'task.expired',
      data: { taskId: task.id, title: task.title, requesterId: task.requesterId },
    });

    logger.info('expired task', { taskId: task.id });
  }
}

async function processAgentDormancy() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const dormantAgents = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.status, AGENT_STATUS.ACTIVE),
        lt(agents.lastHeartbeat, cutoff),
      ),
    );

  for (const agent of dormantAgents) {
    await db
      .update(agents)
      .set({ status: AGENT_STATUS.DORMANT, updatedAt: new Date() })
      .where(eq(agents.id, agent.id));

    eventBus.broadcast({
      type: 'agent.dormant',
      data: { agentId: agent.id, displayName: agent.displayName },
    });

    logger.info('marked agent dormant', { agentId: agent.id });
  }
}

async function processAutoMatch() {
  const autoTasks = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.matchingMode, MATCHING_MODE.AUTO),
        eq(tasks.status, TASK_STATUS.OPEN),
      ),
    );

  for (const task of autoTasks) {
    const requirements = task.skillRequirements ?? [];
    if (requirements.length === 0) continue;

    // Find agents with matching skills (category overlap), excluding the requester
    const matchingAgentRows = await db
      .selectDistinct({ agentId: agentSkills.agentId })
      .from(agentSkills)
      .where(
        and(
          inArray(sql`LOWER(${agentSkills.category})`, requirements.map((r) => r.toLowerCase())),
          ne(agentSkills.agentId, task.requesterId),
        ),
      );

    if (matchingAgentRows.length === 0) continue;

    const matchingAgentIds = matchingAgentRows.map((r) => r.agentId);

    // Filter to active candidates
    const candidateAgents = await db
      .select()
      .from(agents)
      .where(
        and(
          inArray(agents.id, matchingAgentIds),
          eq(agents.status, AGENT_STATUS.ACTIVE),
        ),
      );

    if (candidateAgents.length === 0) continue;

    // Advanced matching: trust + quality + hiring history + collaborative filtering
    const scores = await scoreMatchCandidates(
      task.id,
      task.requesterId,
      candidateAgents.map((a) => a.id),
    );

    const bestMatch = candidateAgents.find((a) => a.id === scores[0]?.agentId) ?? candidateAgents[0];

    const assigned = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM tasks WHERE id = ${task.id} FOR UPDATE`);

      const [currentTask] = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.id, task.id))
        .limit(1);

      if (!currentTask || currentTask.status !== TASK_STATUS.OPEN || currentTask.matchingMode !== MATCHING_MODE.AUTO) {
        return false;
      }

      const [escrow] = await tx
        .select()
        .from(escrowTransactions)
        .where(and(
          eq(escrowTransactions.taskId, task.id),
          eq(escrowTransactions.status, ESCROW_STATUS.FUNDED),
        ))
        .limit(1);

      if (!escrow) {
        logger.warn('skipping auto-match: no funded escrow', { taskId: task.id });
        return false;
      }

      await tx
        .update(tasks)
        .set({
          status: TASK_STATUS.ASSIGNED,
          assigneeId: bestMatch.id,
          finalPrice: currentTask.finalPrice ?? currentTask.budgetMax,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, task.id));

      await tx
        .update(escrowTransactions)
        .set({
          payeeId: bestMatch.id,
          updatedAt: new Date(),
        })
        .where(eq(escrowTransactions.id, escrow.id));

      return true;
    });

    if (!assigned) continue;

    eventBus.emit(bestMatch.id, {
      type: 'task.assigned',
      data: { taskId: task.id, price: (task.finalPrice ?? task.budgetMax).toString() },
    });
    eventBus.broadcast({
      type: 'task.assigned',
      data: { taskId: task.id, assigneeId: bestMatch.id, title: task.title },
    });

    logger.info('auto-matched task', { taskId: task.id, agentId: bestMatch.id });
  }
}

async function cleanupReadMessages() {
  const result = await db.execute(
    sql`DELETE FROM agent_messages WHERE read_at IS NOT NULL AND read_at < now() - interval '7 days'`,
  );
  const deleted = (result as { rowCount?: number }).rowCount ?? 0;
  if (deleted > 0) {
    logger.info('cleaned up acknowledged messages', { deleted });
  }
}

async function cleanupStaleChallenges() {
  const result = await db
    .delete(challenges)
    .where(or(lt(challenges.expiresAt, new Date()), eq(challenges.used, true)));
  const deleted = (result as { rowCount?: number }).rowCount ?? 0;
  if (deleted > 0) {
    logger.info('cleaned up stale/used challenges', { deleted });
  }
}

const MAX_ESCROW_RETRIES = 5;

async function processStuckEscrows() {
  // Find escrows stuck in RELEASING or REFUNDING status (failed Phase 2)
  const stuckEscrows = await db
    .select()
    .from(escrowTransactions)
    .where(
      and(
        inArray(escrowTransactions.status, [ESCROW_STATUS.RELEASING, ESCROW_STATUS.REFUNDING]),
        lt(escrowTransactions.updatedAt, new Date(Date.now() - 5 * 60_000)), // older than 5 minutes
        lt(escrowTransactions.retryCount, MAX_ESCROW_RETRIES),
      ),
    );

  for (const escrow of stuckEscrows) {
    try {
      if (escrow.status === ESCROW_STATUS.RELEASING) {
        await releaseEscrow(escrow.taskId);
        logger.info('retried escrow release successfully', { taskId: escrow.taskId, retryCount: escrow.retryCount });
      } else {
        await refundEscrow(escrow.taskId);
        logger.info('retried escrow refund successfully', { taskId: escrow.taskId, retryCount: escrow.retryCount });
      }
    } catch (error) {
      logger.error('escrow retry failed', { taskId: escrow.taskId, status: escrow.status, retryCount: escrow.retryCount, error: String(error) });

      // If max retries exceeded, mark as permanently failed
      if (escrow.retryCount + 1 >= MAX_ESCROW_RETRIES) {
        const failedStatus = escrow.status === ESCROW_STATUS.RELEASING
          ? ESCROW_STATUS.RELEASE_FAILED
          : ESCROW_STATUS.REFUND_FAILED;

        await db
          .update(escrowTransactions)
          .set({ status: failedStatus, updatedAt: new Date() })
          .where(eq(escrowTransactions.id, escrow.id));

        eventBus.broadcast({
          type: 'payment.stuck',
          data: { taskId: escrow.taskId, escrowId: escrow.id, status: failedStatus, retries: escrow.retryCount + 1 },
        });

        logger.error('escrow permanently failed, requires admin intervention', { taskId: escrow.taskId, escrowId: escrow.id, status: failedStatus });
      }
    }
  }
}

async function start() {
  logger.info('starting');

  // Log feature flag status
  const flags = {
    'Outbox processor': isWorkerEnabled('ENABLE_EVENT_OUTBOX'),
    'Task expiry': isWorkerEnabled('ENABLE_WORKER_TASK_EXPIRY'),
    'Agent dormancy': isWorkerEnabled('ENABLE_WORKER_DORMANCY'),
    'Auto-matching': isWorkerEnabled('ENABLE_WORKER_AUTO_MATCH'),
    'Anomaly detection': isWorkerEnabled('ENABLE_WORKER_ANOMALY_DETECTION', '0'),
  };
  for (const [name, enabled] of Object.entries(flags)) {
    logger.info(`${name}: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  if (isSearchEnabled()) {
    await syncAllSearchIndexes().catch((error) => {
      logger.error('initial search sync failed', { error: String(error) });
    });
  }

  // Outbox processor
  if (isWorkerEnabled('ENABLE_EVENT_OUTBOX')) {
    await timedWorker('outbox', processOutboxBatch);
    trackInterval(setInterval(() => {
      void timedWorker('outbox', processOutboxBatch);
    }, Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 2000)));

    // Challenge cleanup — every 10 minutes (lightweight, shares outbox gate)
    trackInterval(setInterval(() => {
      void timedWorker('challenge_cleanup', cleanupStaleChallenges).catch((err) => {
        logger.error('challenge cleanup error', { error: String(err) });
      });
    }, 10 * 60_000));
  }

  // Task expiry loop — every 60s
  if (isWorkerEnabled('ENABLE_WORKER_TASK_EXPIRY')) {
    trackInterval(setInterval(() => {
      void timedWorker('task_expiry', processTaskExpiry).catch((err) => {
        logger.error('task expiry loop error', { error: String(err) });
      });
    }, 60_000));
  }

  // Agent dormancy loop — every 5 minutes
  if (isWorkerEnabled('ENABLE_WORKER_DORMANCY')) {
    trackInterval(setInterval(() => {
      void timedWorker('dormancy', processAgentDormancy).catch((err) => {
        logger.error('agent dormancy loop error', { error: String(err) });
      });
    }, 5 * 60_000));
  }

  // Auto-match loop — every 10s
  if (isWorkerEnabled('ENABLE_WORKER_AUTO_MATCH')) {
    trackInterval(setInterval(() => {
      void timedWorker('auto_match', processAutoMatch).catch((err) => {
        logger.error('auto-match loop error', { error: String(err) });
      });
    }, 10_000));
  }

  // Anomaly detection loop — every 5 minutes (opt-in)
  if (isWorkerEnabled('ENABLE_WORKER_ANOMALY_DETECTION', '0')) {
    trackInterval(setInterval(() => {
      void timedWorker('anomaly_detection', runAnomalyDetection).catch((err) => {
        logger.error('anomaly detection error', { error: String(err) });
      });
    }, 5 * 60_000));
  }

  // Escrow retry loop — every 2 minutes, retry stuck releasing/refunding escrows
  trackInterval(setInterval(() => {
    void timedWorker('escrow_retry', processStuckEscrows, 120).catch((err) => {
      logger.error('escrow retry loop error', { error: String(err) });
    });
  }, 2 * 60_000));

  // Message cleanup loop — every hour, remove acknowledged messages older than 7 days
  trackInterval(setInterval(() => {
    void timedWorker('message_cleanup', cleanupReadMessages).catch((err) => {
      logger.error('message cleanup error', { error: String(err) });
    });
  }, 60 * 60_000));

  // MCP registry ingestion — every 6 hours, pulls from Smithery + modelcontextprotocol/servers
  if (isWorkerEnabled('ENABLE_WORKER_MCP_INGEST', '1')) {
    const runIngest = async () => {
      const results = await runMcpIngestionBatch();
      logger.info('mcp ingest completed', { results: JSON.stringify(results) });
    };
    trackInterval(setInterval(() => {
      void timedWorker('mcp_ingest', runIngest, 600).catch((err) => {
        logger.error('mcp ingest error', { error: String(err) });
      });
    }, Number(process.env.MCP_INGEST_INTERVAL_MS ?? 6 * 60 * 60_000)));
  }
}

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down gracefully...`);
  for (const interval of activeIntervals) {
    clearInterval(interval);
  }
  // Allow in-flight iterations to complete, then exit
  setTimeout(() => {
    logger.info('shutdown complete');
    process.exit(0);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

void start();
