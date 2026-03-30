import { Hono } from 'hono';
import { db } from '../db/client.js';
import { tasks, taskBids, transactions, agentReputation } from '../db/schema.js';
import { eq, and, sql, count } from 'drizzle-orm';
import { TASK_STATUS, TRANSACTION_TYPE, BID_STATUS } from '@swarmdock/shared';
import { authMiddleware } from '../middleware/auth.js';

const app = new Hono();

// GET /api/v1/analytics/:agentId — Agent performance analytics
app.get('/:agentId', authMiddleware, async (c) => {
  const agentId = c.req.param('agentId');

  // Tasks completed
  const [completedResult] = await db
    .select({ value: count() })
    .from(tasks)
    .where(and(eq(tasks.assigneeId, agentId), eq(tasks.status, TASK_STATUS.COMPLETED)));
  const tasksCompleted = completedResult.value;

  // Total earnings from escrow_release transactions
  const [earningsResult] = await db
    .select({ value: sql<string>`coalesce(sum(${transactions.amount}), 0)` })
    .from(transactions)
    .where(
      and(
        eq(transactions.toAgentId, agentId),
        eq(transactions.type, TRANSACTION_TYPE.ESCROW_RELEASE),
      ),
    );
  const totalEarnings = earningsResult.value;

  // Bid win rate
  const [totalBidsResult] = await db
    .select({ value: count() })
    .from(taskBids)
    .where(eq(taskBids.bidderId, agentId));

  const [acceptedBidsResult] = await db
    .select({ value: count() })
    .from(taskBids)
    .where(and(eq(taskBids.bidderId, agentId), eq(taskBids.status, BID_STATUS.ACCEPTED)));

  const totalBids = totalBidsResult.value;
  const acceptedBids = acceptedBidsResult.value;
  const bidWinRate = totalBids > 0 ? acceptedBids / totalBids : 0;

  // Average completion time (in seconds)
  const [avgTimeResult] = await db
    .select({
      value: sql<number | null>`avg(extract(epoch from ${tasks.completedAt} - ${tasks.startedAt}))`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.assigneeId, agentId),
        eq(tasks.status, TASK_STATUS.COMPLETED),
        sql`${tasks.startedAt} is not null`,
        sql`${tasks.completedAt} is not null`,
      ),
    );
  const avgCompletionTime = avgTimeResult.value ?? null;

  // Reputation trend — latest scores across all dimensions
  const reputationTrend = await db
    .select({
      dimension: agentReputation.dimension,
      score: agentReputation.score,
      confidence: agentReputation.confidence,
      totalRatings: agentReputation.totalRatings,
      recentTrend: agentReputation.recentTrend,
      updatedAt: agentReputation.updatedAt,
    })
    .from(agentReputation)
    .where(eq(agentReputation.agentId, agentId));

  return c.json({
    agentId,
    tasksCompleted,
    totalEarnings,
    bidWinRate,
    avgCompletionTime,
    reputationTrend,
  });
});

export default app;
