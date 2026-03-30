import { indexAgentDocument, indexTaskDocument, isSearchEnabled, syncAllSearchIndexes } from './services/search.js';
import { listPendingOutbox, markOutboxFailed, markOutboxPublished } from './services/outbox.js';
import { isNatsConfigured, publishNatsEvent, toJetStreamSubject } from './lib/nats.js';
import { runAnomalyDetection } from './services/anomaly.js';
import { workerIterationDuration } from './lib/metrics.js';
import { db } from './db/client.js';
import { agents, tasks, agentSkills, escrowTransactions } from './db/schema.js';
import { eq, and, lt, inArray, sql, ne } from 'drizzle-orm';
import { TASK_STATUS, AGENT_STATUS, MATCHING_MODE, ESCROW_STATUS } from '@swarmdock/shared';
import { eventBus } from './lib/events.js';

function isWorkerEnabled(envVar: string, defaultValue = '1'): boolean {
  return (process.env[envVar] ?? defaultValue) === '1';
}

/** Run a worker function and record its duration to the OTel histogram. */
async function timedWorker(name: string, fn: () => Promise<unknown>): Promise<void> {
  const start = performance.now();
  try {
    await fn();
  } finally {
    workerIterationDuration.record(performance.now() - start, { worker: name });
  }
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
      console.error('[WORKER] failed to process outbox row', row.id, error);
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

    console.log(`[WORKER] expired task ${task.id}`);
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

    console.log(`[WORKER] marked agent ${agent.id} as dormant`);
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

    // Pick the best match: highest trust_level, then highest avg_quality_score
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

    // Sort by trust_level desc, then by avgQualityScore from skills
    const bestMatch = candidateAgents.sort((a, b) => {
      if (b.trustLevel !== a.trustLevel) return b.trustLevel - a.trustLevel;
      return 0;
    })[0];

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
        console.warn(`[WORKER] skipping auto-match for task ${task.id}: no funded escrow`);
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

    console.log(`[WORKER] auto-matched task ${task.id} to agent ${bestMatch.id}`);
  }
}

async function start() {
  console.log('[WORKER] starting');

  // Log feature flag status
  const flags = {
    'Outbox processor': isWorkerEnabled('ENABLE_EVENT_OUTBOX'),
    'Task expiry': isWorkerEnabled('ENABLE_WORKER_TASK_EXPIRY'),
    'Agent dormancy': isWorkerEnabled('ENABLE_WORKER_DORMANCY'),
    'Auto-matching': isWorkerEnabled('ENABLE_WORKER_AUTO_MATCH'),
    'Anomaly detection': isWorkerEnabled('ENABLE_WORKER_ANOMALY_DETECTION', '0'),
  };
  for (const [name, enabled] of Object.entries(flags)) {
    console.log(`[WORKER] ${name}: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }

  if (isSearchEnabled()) {
    await syncAllSearchIndexes().catch((error) => {
      console.error('[WORKER] initial search sync failed:', error);
    });
  }

  // Outbox processor
  if (isWorkerEnabled('ENABLE_EVENT_OUTBOX')) {
    await timedWorker('outbox', processOutboxBatch);
    setInterval(() => {
      void timedWorker('outbox', processOutboxBatch);
    }, Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 2000));
  }

  // Task expiry loop — every 60s
  if (isWorkerEnabled('ENABLE_WORKER_TASK_EXPIRY')) {
    setInterval(() => {
      void timedWorker('task_expiry', processTaskExpiry).catch((err) => {
        console.error('[WORKER] task expiry loop error:', err);
      });
    }, 60_000);
  }

  // Agent dormancy loop — every 5 minutes
  if (isWorkerEnabled('ENABLE_WORKER_DORMANCY')) {
    setInterval(() => {
      void timedWorker('dormancy', processAgentDormancy).catch((err) => {
        console.error('[WORKER] agent dormancy loop error:', err);
      });
    }, 5 * 60_000);
  }

  // Auto-match loop — every 10s
  if (isWorkerEnabled('ENABLE_WORKER_AUTO_MATCH')) {
    setInterval(() => {
      void timedWorker('auto_match', processAutoMatch).catch((err) => {
        console.error('[WORKER] auto-match loop error:', err);
      });
    }, 10_000);
  }

  // Anomaly detection loop — every 5 minutes (opt-in)
  if (isWorkerEnabled('ENABLE_WORKER_ANOMALY_DETECTION', '0')) {
    setInterval(() => {
      void timedWorker('anomaly_detection', runAnomalyDetection).catch((err) => {
        console.error('[WORKER] anomaly detection error:', err);
      });
    }, 5 * 60_000);
  }
}

void start();
