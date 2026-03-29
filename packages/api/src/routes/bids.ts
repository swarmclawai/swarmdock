import { Hono } from 'hono';
import { db, type Database } from '../db/client.js';
import { tasks, taskBids, escrowTransactions } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { authMiddleware, requireScope, type AuthContext } from '../middleware/auth.js';
import { BidCreateSchema, TASK_STATUS, BID_STATUS, ESCROW_STATUS } from '@swarmdock/shared';
import { eventBus } from '../lib/events.js';

type BidContext = AuthContext & { Variables: AuthContext['Variables'] };

type BidRouteDeps = {
  db: Pick<Database, 'select' | 'insert' | 'update' | 'transaction'>;
  authMiddleware: typeof authMiddleware;
  requireScope: typeof requireScope;
  eventBus: Pick<typeof eventBus, 'emit'>;
  createTxHash: () => string;
};

function createSimulatedTxHash(): string {
  return `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
}

export function createBidsApp(overrides: Partial<BidRouteDeps> = {}) {
  const database = overrides.db ?? db;
  const requireAuth = overrides.authMiddleware ?? authMiddleware;
  const withScope = overrides.requireScope ?? requireScope;
  const events = overrides.eventBus ?? eventBus;
  const createTxHash = overrides.createTxHash ?? createSimulatedTxHash;
  const app = new Hono<BidContext>();

  // POST /api/v1/tasks/:taskId/bids — Submit bid
  app.post('/', requireAuth, withScope('bids.write'), async (c) => {
    const taskId = c.req.param('taskId') as string;
    const agent = c.get('agent');

    const [task] = await database.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
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
    const [existingBid] = await database
      .select()
      .from(taskBids)
      .where(and(eq(taskBids.taskId, taskId), eq(taskBids.bidderId, agent.agent_id)))
      .limit(1);

    if (existingBid) {
      return c.json({ error: 'Already bid on this task' }, 409);
    }

    const [bid] = await database.insert(taskBids).values({
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
      await database.update(tasks).set({ status: TASK_STATUS.BIDDING, updatedAt: new Date() }).where(eq(tasks.id, taskId));
    }

    events.emit(task.requesterId, {
      type: 'task.bid_received',
      data: { taskId, bidderId: agent.agent_id, price: parsed.data.proposedPrice },
    });

    return c.json(bid, 201);
  });

  // GET /api/v1/tasks/:taskId/bids — List bids
  app.get('/', async (c) => {
    const taskId = c.req.param('taskId') as string;
    const bids = await database.select().from(taskBids).where(eq(taskBids.taskId, taskId));
    return c.json({ bids });
  });

  // POST /api/v1/tasks/:taskId/bids/:bidId/accept — Accept bid
  app.post('/:bidId/accept', requireAuth, withScope('tasks.write'), async (c) => {
    const taskId = c.req.param('taskId') as string;
    const bidId = c.req.param('bidId');
    const agent = c.get('agent');

    const [task] = await database.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) return c.json({ error: 'Task not found' }, 404);
    if (task.requesterId !== agent.agent_id) return c.json({ error: 'Not task owner' }, 403);
    if (![TASK_STATUS.OPEN, TASK_STATUS.BIDDING].includes(task.status as 'open' | 'bidding')) {
      return c.json({ error: 'Task not accepting bids' }, 400);
    }

    const [bid] = await database
      .select()
      .from(taskBids)
      .where(and(eq(taskBids.id, bidId), eq(taskBids.taskId, taskId)))
      .limit(1);

    if (!bid) return c.json({ error: 'Bid not found' }, 404);
    if (bid.status !== BID_STATUS.PENDING) return c.json({ error: 'Bid no longer pending' }, 400);

    const escrowTxHash = createTxHash();

    // Accept this bid, assign the task, and record funded escrow in one transaction.
    const { updatedTask, escrow } = await database.transaction(async (tx) => {
      await tx.update(taskBids).set({ status: BID_STATUS.ACCEPTED }).where(eq(taskBids.id, bidId));
      await tx.update(taskBids).set({ status: BID_STATUS.REJECTED })
        .where(and(eq(taskBids.taskId, taskId), eq(taskBids.status, BID_STATUS.PENDING)));

      const [updatedTask] = await tx.update(tasks).set({
        assigneeId: bid.bidderId,
        finalPrice: bid.proposedPrice,
        status: TASK_STATUS.ASSIGNED,
        updatedAt: new Date(),
      }).where(eq(tasks.id, taskId)).returning();

      const [escrow] = await tx.insert(escrowTransactions).values({
        taskId,
        payerId: agent.agent_id,
        payeeId: bid.bidderId,
        amount: bid.proposedPrice,
        status: ESCROW_STATUS.FUNDED,
        escrowTxHash,
        network: process.env.X402_NETWORK ?? 'base-sepolia',
      }).returning();

      return { updatedTask, escrow };
    });

    events.emit(bid.bidderId, {
      type: 'task.assigned',
      data: { taskId, price: bid.proposedPrice.toString() },
    });
    events.emit(agent.agent_id, {
      type: 'payment.escrowed',
      data: { taskId, amount: bid.proposedPrice.toString(), txHash: escrow.escrowTxHash },
    });

    return c.json({ task: updatedTask, acceptedBid: bid, escrow });
  });

  return app;
}

export default createBidsApp();
