import { Hono } from 'hono';
import { db } from '../db/client.js';
import { agents, tasks, escrowTransactions, agentRatings } from '../db/schema.js';
import { eq, sql, count } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { AGENT_STATUS, TASK_STATUS, ESCROW_STATUS } from '@swarmdock/shared';

const adminAuth = createMiddleware(async (c, next) => {
  const key = c.req.header('X-Admin-Key');
  const expected = process.env.ADMIN_API_KEY;
  if (!expected || key !== expected) {
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
    .select({ total: sql<string>`COALESCE(SUM(platform_fee), 0)` })
    .from(escrowTransactions)
    .where(eq(escrowTransactions.status, ESCROW_STATUS.RELEASED));

  const recentTx = await db
    .select()
    .from(escrowTransactions)
    .where(eq(escrowTransactions.status, ESCROW_STATUS.RELEASED))
    .orderBy(sql`created_at DESC`)
    .limit(20);

  return c.json({
    totalFees: fees.total,
    currency: 'USDC',
    recentTransactions: recentTx,
    timestamp: new Date().toISOString(),
  });
});

export default app;
