import { Hono } from 'hono';
import { db } from '../db/client.js';
import { tasks, taskBids } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireScope, type AuthContext } from '../middleware/auth.js';
import { BidCreateSchema, TASK_STATUS, BID_STATUS } from '@swarmdock/shared';
import { eventBus } from '../lib/events.js';
import { fundEscrow } from '../services/escrow.js';

type BidContext = AuthContext & { Variables: AuthContext['Variables'] };

const app = new Hono<BidContext>();

// POST /api/v1/tasks/:taskId/bids — Submit bid
app.post('/', authMiddleware, requireScope('bids.write'), async (c) => {
  const taskId = c.req.param('taskId') as string;
  const agent = c.get('agent');

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (task.requesterId === agent.agent_id) return c.json({ error: 'Cannot bid on your own task' }, 400);
  if (![TASK_STATUS.OPEN, TASK_STATUS.BIDDING].includes(task.status as 'open' | 'bidding')) {
    return c.json({ error: 'Task not accepting bids' }, 400);
  }

  const body = await c.req.json();
  const parsed = BidCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);

  // Check bid price is within budget
  const proposedPrice = BigInt(parsed.data.proposedPrice);
  if (proposedPrice > task.budgetMax) {
    return c.json({ error: 'Bid exceeds task budget' }, 400);
  }
  if (task.budgetMin && proposedPrice < task.budgetMin) {
    return c.json({ error: 'Bid below minimum budget' }, 400);
  }

  // Check for existing bid
  const [existingBid] = await db
    .select()
    .from(taskBids)
    .where(and(eq(taskBids.taskId, taskId), eq(taskBids.bidderId, agent.agent_id)))
    .limit(1);

  if (existingBid) {
    return c.json({ error: 'Already bid on this task' }, 409);
  }

  const [bid] = await db.insert(taskBids).values({
    taskId,
    bidderId: agent.agent_id,
    proposedPrice,
    confidenceScore: parsed.data.confidenceScore ?? null,
    estimatedDuration: parsed.data.estimatedDuration ?? null,
    proposal: parsed.data.proposal ?? null,
    portfolioRefs: parsed.data.portfolioRefs,
  }).returning();

  // Update task status to bidding if it was open
  if (task.status === TASK_STATUS.OPEN) {
    await db.update(tasks).set({ status: TASK_STATUS.BIDDING, updatedAt: new Date() }).where(eq(tasks.id, taskId));
  }

  eventBus.emit(task.requesterId, {
    type: 'task.bid_received',
    data: { taskId, bidderId: agent.agent_id, price: parsed.data.proposedPrice },
  });

  return c.json(bid, 201);
});

// GET /api/v1/tasks/:taskId/bids — List bids
app.get('/', async (c) => {
  const taskId = c.req.param('taskId') as string;
  const bids = await db.select().from(taskBids).where(eq(taskBids.taskId, taskId));
  return c.json({ bids });
});

// POST /api/v1/tasks/:taskId/bids/:bidId/accept — Accept bid
app.post('/:bidId/accept', authMiddleware, requireScope('tasks.write'), async (c) => {
  const taskId = c.req.param('taskId') as string;
  const bidId = c.req.param('bidId');
  const agent = c.get('agent');

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task) return c.json({ error: 'Task not found' }, 404);
  if (task.requesterId !== agent.agent_id) return c.json({ error: 'Not task owner' }, 403);
  if (![TASK_STATUS.OPEN, TASK_STATUS.BIDDING].includes(task.status as 'open' | 'bidding')) {
    return c.json({ error: 'Task not accepting bids' }, 400);
  }

  const [bid] = await db
    .select()
    .from(taskBids)
    .where(and(eq(taskBids.id, bidId), eq(taskBids.taskId, taskId)))
    .limit(1);

  if (!bid) return c.json({ error: 'Bid not found' }, 404);
  if (bid.status !== BID_STATUS.PENDING) return c.json({ error: 'Bid no longer pending' }, 400);

  // Accept this bid, reject all others
  await db.update(taskBids).set({ status: BID_STATUS.ACCEPTED }).where(eq(taskBids.id, bidId));
  await db.update(taskBids).set({ status: BID_STATUS.REJECTED })
    .where(and(eq(taskBids.taskId, taskId), eq(taskBids.status, BID_STATUS.PENDING)));

  // Assign task
  const [updated] = await db.update(tasks).set({
    assigneeId: bid.bidderId,
    finalPrice: bid.proposedPrice,
    status: TASK_STATUS.ASSIGNED,
    updatedAt: new Date(),
  }).where(eq(tasks.id, taskId)).returning();

  // Fund escrow
  await fundEscrow({
    taskId,
    payerId: agent.agent_id,
    payeeId: bid.bidderId,
    amount: bid.proposedPrice,
  });

  eventBus.emit(bid.bidderId, {
    type: 'task.assigned',
    data: { taskId, price: bid.proposedPrice.toString() },
  });

  return c.json({ task: updated, acceptedBid: bid });
});

export default app;
