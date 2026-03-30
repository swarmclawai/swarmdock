import { Hono } from 'hono';
import { db } from '../db/client.js';
import { agents, tasks, escrowTransactions, transactions, agentRatings, disputes, anomalyEvents, agentReputation } from '../db/schema.js';
import { eq, sql, count, desc, and } from 'drizzle-orm';
import { timingSafeEqual } from 'node:crypto';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import {
  AGENT_STATUS,
  TASK_STATUS,
  ESCROW_STATUS,
  TRANSACTION_TYPE,
  TRANSACTION_STATUS,
  DisputeResolveSchema,
  DISPUTE_STATUS,
  DISPUTE_RESOLUTION,
} from '@swarmdock/shared';
import { releaseEscrow, refundEscrow } from '../services/escrow.js';
import { selectTribunalJudges } from '../services/tribunal.js';
import { unsuspendAgent } from '../services/anomaly.js';
import { eventBus } from '../lib/events.js';

const adminAuth = createMiddleware(async (c, next) => {
  const key = c.req.header('X-Admin-Key');
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || !key || key.length !== expected.length ||
      !timingSafeEqual(Buffer.from(key), Buffer.from(expected))) {
    throw new HTTPException(401, { message: 'Invalid or missing admin key' });
  }
  await next();
});

const app = new Hono();

// GET /api/v1/admin/stats — Platform overview
app.get('/stats', adminAuth, async (c) => {
  const [agentStats] = await db
    .select({ count: count() })
    .from(agents)
    .where(eq(agents.status, AGENT_STATUS.ACTIVE));

  const [taskTotal] = await db.select({ count: count() }).from(tasks);
  const [taskCompleted] = await db
    .select({ count: count() })
    .from(tasks)
    .where(eq(tasks.status, TASK_STATUS.COMPLETED));
  const [taskOpen] = await db
    .select({ count: count() })
    .from(tasks)
    .where(eq(tasks.status, TASK_STATUS.OPEN));

  const [volume] = await db
    .select({ total: sql<string>`COALESCE(SUM(amount), 0)` })
    .from(escrowTransactions)
    .where(eq(escrowTransactions.status, ESCROW_STATUS.RELEASED));

  const [ratingCount] = await db.select({ count: count() }).from(agentRatings);

  return c.json({
    agents: { active: agentStats.count },
    tasks: {
      total: taskTotal.count,
      open: taskOpen.count,
      completed: taskCompleted.count,
    },
    volume: { totalReleased: volume.total, currency: 'USDC' },
    ratings: { total: ratingCount.count },
    timestamp: new Date().toISOString(),
  });
});

// GET /api/v1/admin/revenue — Platform fee revenue
app.get('/revenue', adminAuth, async (c) => {
  const [fees] = await db
    .select({ total: sql<string>`COALESCE(SUM(amount), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.type, TRANSACTION_TYPE.PLATFORM_FEE),
        eq(transactions.status, TRANSACTION_STATUS.CONFIRMED),
      ),
    );

  const recentTx = await db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.type, TRANSACTION_TYPE.PLATFORM_FEE),
        eq(transactions.status, TRANSACTION_STATUS.CONFIRMED),
      ),
    )
    .orderBy(desc(transactions.createdAt))
    .limit(20);

  return c.json({
    totalFees: fees.total,
    currency: 'USDC',
    recentTransactions: recentTx,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/v1/admin/transactions — Full transaction history
app.get('/transactions', adminAuth, async (c) => {
  const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200));
  const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10) || 0);

  const rows = await db
    .select()
    .from(transactions)
    .orderBy(desc(transactions.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db.select({ total: count() }).from(transactions);

  return c.json({
    transactions: rows,
    limit,
    offset,
    total,
    timestamp: new Date().toISOString(),
  });
});

// GET /api/v1/admin/disputes — List disputes, newest first
app.get('/disputes', adminAuth, async (c) => {
  const status = c.req.query('status');
  const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200));
  const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10) || 0);

  const whereClause = status ? eq(disputes.status, status) : undefined;
  const rows = await db
    .select()
    .from(disputes)
    .where(whereClause)
    .orderBy(desc(disputes.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db.select({ total: count() }).from(disputes).where(whereClause);

  return c.json({
    disputes: rows,
    limit,
    offset,
    total,
  });
});

// GET /api/v1/admin/disputes/:id/tribunal — Trigger tribunal selection
app.get('/disputes/:id/tribunal', adminAuth, async (c) => {
  const id = c.req.param('id');

  const [dispute] = await db
    .select()
    .from(disputes)
    .where(and(eq(disputes.id, id), eq(disputes.status, DISPUTE_STATUS.OPEN)))
    .limit(1);

  if (!dispute) {
    return c.json({ error: 'Open dispute not found' }, 404);
  }

  const tribunalAgents = await selectTribunalJudges(dispute.id);

  const [updatedDispute] = await db
    .update(disputes)
    .set({
      status: DISPUTE_STATUS.TRIBUNAL,
      tribunalAgents,
      updatedAt: new Date(),
    })
    .where(eq(disputes.id, id))
    .returning();

  // Notify tribunal agents
  for (const agentId of tribunalAgents) {
    eventBus.emit(agentId, {
      type: 'dispute.tribunal_selected',
      data: { disputeId: id, taskId: dispute.taskId },
    });
  }

  return c.json({ dispute: updatedDispute, tribunalAgents });
});

// POST /api/v1/admin/disputes/:id/resolve — Resolve a dispute by release, refund, or split
app.post('/disputes/:id/resolve', adminAuth, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = DisputeResolveSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const [dispute] = await db
    .select()
    .from(disputes)
    .where(and(eq(disputes.id, id), eq(disputes.status, DISPUTE_STATUS.OPEN)))
    .limit(1);

  if (!dispute) {
    return c.json({ error: 'Open dispute not found' }, 404);
  }

  const [task] = await db.select().from(tasks).where(eq(tasks.id, dispute.taskId)).limit(1);
  if (!task) {
    return c.json({ error: 'Task not found for dispute' }, 404);
  }

  let resolutionData: Record<string, unknown> = {};
  if (parsed.data.resolution === DISPUTE_RESOLUTION.RELEASE) {
    const { releaseTxHash } = await releaseEscrow(task.id);
    const [updatedTask] = await db.update(tasks).set({
      status: TASK_STATUS.COMPLETED,
      completedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(tasks.id, task.id)).returning();
    resolutionData = { releaseTxHash, task: updatedTask };
  } else {
    await refundEscrow(task.id);
    const [updatedTask] = await db.update(tasks).set({
      status: TASK_STATUS.FAILED,
      updatedAt: new Date(),
    }).where(eq(tasks.id, task.id)).returning();
    resolutionData = { task: updatedTask };
  }

  const [updatedDispute] = await db.update(disputes).set({
    status: DISPUTE_STATUS.RESOLVED,
    resolution: parsed.data.resolution,
    resolutionNotes: parsed.data.notes ?? null,
    resolvedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(disputes.id, dispute.id)).returning();

  for (const agentId of [dispute.raisedByAgentId, dispute.againstAgentId].filter((value): value is string => Boolean(value))) {
    eventBus.emit(agentId, {
      type: 'task.dispute_resolved',
      data: {
        taskId: task.id,
        disputeId: dispute.id,
        resolution: parsed.data.resolution,
      },
    });
  }

  return c.json({
    dispute: updatedDispute,
    ...resolutionData,
  });
});

// GET /api/v1/admin/anomalies — List anomaly events
app.get('/anomalies', adminAuth, async (c) => {
  const type = c.req.query('type');
  const severity = c.req.query('severity');
  const agentId = c.req.query('agentId');
  const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') ?? '50', 10) || 50, 200));
  const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10) || 0);

  const conditions = [];
  if (type) conditions.push(eq(anomalyEvents.type, type));
  if (severity) conditions.push(eq(anomalyEvents.severity, severity));
  if (agentId) conditions.push(eq(anomalyEvents.agentId, agentId));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(anomalyEvents)
    .where(whereClause)
    .orderBy(desc(anomalyEvents.createdAt))
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db.select({ total: count() }).from(anomalyEvents).where(whereClause);

  return c.json({ anomalies: rows, limit, offset, total });
});

// GET /api/v1/admin/agents/:id/risk — Agent risk profile
app.get('/agents/:id/risk', adminAuth, async (c) => {
  const id = c.req.param('id');

  const [agent] = await db
    .select({ id: agents.id, displayName: agents.displayName, status: agents.status, trustLevel: agents.trustLevel })
    .from(agents)
    .where(eq(agents.id, id))
    .limit(1);

  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  const anomalies = await db
    .select()
    .from(anomalyEvents)
    .where(eq(anomalyEvents.agentId, id))
    .orderBy(desc(anomalyEvents.createdAt))
    .limit(20);

  const reputation = await db
    .select()
    .from(agentReputation)
    .where(eq(agentReputation.agentId, id));

  const highCount = anomalies.filter((a) => a.severity === 'high').length;
  const mediumCount = anomalies.filter((a) => a.severity === 'medium').length;

  return c.json({
    agent: { id: agent.id, displayName: agent.displayName, status: agent.status, trustLevel: agent.trustLevel },
    anomalySummary: { total: anomalies.length, high: highCount, medium: mediumCount },
    recentAnomalies: anomalies,
    reputation,
  });
});

// POST /api/v1/admin/agents/:id/unsuspend — Lift suspension
app.post('/agents/:id/unsuspend', adminAuth, async (c) => {
  const id = c.req.param('id');

  const [agent] = await db
    .select({ status: agents.status })
    .from(agents)
    .where(eq(agents.id, id))
    .limit(1);

  if (!agent) return c.json({ error: 'Agent not found' }, 404);
  if (agent.status !== AGENT_STATUS.SUSPENDED) {
    return c.json({ error: 'Agent is not suspended' }, 400);
  }

  const body = await c.req.json().catch(() => ({})) as { note?: string };
  await unsuspendAgent(id, body.note ?? 'Admin unsuspend');

  return c.json({ unsuspended: true, agentId: id });
});

// POST /api/v1/admin/agents/:id/premium — Set premium tier
app.post('/agents/:id/premium', adminAuth, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({})) as { tier?: string | null; badge?: boolean };

  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.id, id))
    .limit(1);

  if (!agent) return c.json({ error: 'Agent not found' }, 404);

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if ('tier' in body) updates.premiumTier = body.tier ?? null;
  if ('badge' in body) updates.isVerifiedBadge = body.badge ?? false;

  await db.update(agents).set(updates).where(eq(agents.id, id));

  return c.json({ updated: true, agentId: id, premiumTier: body.tier, isVerifiedBadge: body.badge });
});

export default app;
