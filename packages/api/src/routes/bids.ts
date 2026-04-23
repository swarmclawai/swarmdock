import { Hono } from 'hono';
import { db, type Database } from '../db/client.js';
import { tasks, taskBids, escrowTransactions } from '../db/schema.js';
import { eq, and, ne, sql, desc, count } from 'drizzle-orm';
import { authMiddleware, optionalAuthMiddleware, requireScope, type AuthContext } from '../middleware/auth.js';
import { BidCreateSchema, TASK_STATUS, BID_STATUS, ESCROW_STATUS } from '@swarmdock/shared';
import { eventBus } from '../lib/events.js';
import { getX402Network, microUsdcToUsdPrice, requireX402Payment } from '../services/x402.js';
import { createSimulatedTxHash } from '../services/escrow.js';
import { canReadTask } from './task-access.js';
import { sanitizeFreeText } from '../lib/sanitize.js';
import { parsePagination } from '../lib/pagination.js';

type BidContext = AuthContext & { Variables: AuthContext['Variables'] };

type BidRouteDeps = {
  db: Pick<Database, 'select' | 'insert' | 'update' | 'transaction'>;
  authMiddleware: typeof authMiddleware;
  optionalAuthMiddleware: typeof optionalAuthMiddleware;
  requireScope: typeof requireScope;
  eventBus: Pick<typeof eventBus, 'emit' | 'broadcast'>;
  createTxHash: () => string;
  requirePayment: typeof requireX402Payment;
  canReadTask: typeof canReadTask;
};

export function createBidsApp(overrides: Partial<BidRouteDeps> = {}) {
  const database = overrides.db ?? db;
  const requireAuth = overrides.authMiddleware ?? authMiddleware;
  const maybeAuth = overrides.optionalAuthMiddleware ?? optionalAuthMiddleware;
  const withScope = overrides.requireScope ?? requireScope;
  const events = overrides.eventBus ?? eventBus;
  const createTxHash = overrides.createTxHash ?? createSimulatedTxHash;
  const requirePayment = overrides.requirePayment ?? requireX402Payment;
  const canViewerReadTask = overrides.canReadTask ?? canReadTask;
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
      proposal: parsed.data.proposal ? sanitizeFreeText(parsed.data.proposal) : null,
      portfolioRefs: parsed.data.portfolioRefs,
    }).returning();

    // Update task status to bidding if it was open
    if (task.status === TASK_STATUS.OPEN) {
      await database.update(tasks).set({ status: TASK_STATUS.BIDDING, updatedAt: new Date() }).where(eq(tasks.id, taskId));
    }

    events.broadcast({
      type: 'task.updated',
      data: { taskId, status: TASK_STATUS.BIDDING },
    });
    events.emit(task.requesterId, {
      type: 'task.bid_received',
      data: { taskId, bidderId: agent.agent_id, price: parsed.data.proposedPrice },
    });

    return c.json(bid, 201);
  });

  // GET /api/v1/tasks/:taskId/bids — List bids
  app.get('/', maybeAuth, async (c) => {
    const taskId = c.req.param('taskId') as string;
    const [task] = await database
      .select({
        id: tasks.id,
        visibility: tasks.visibility,
        requesterId: tasks.requesterId,
        assigneeId: tasks.assigneeId,
      })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!task) {
      return c.json({ error: 'Task not found' }, 404);
    }

    const viewerAgentId = c.get('agent')?.agent_id ?? null;
    if (!await canViewerReadTask(database, task, viewerAgentId)) {
      return c.json({ error: 'Task not found' }, 404);
    }

    const { limit, offset } = parsePagination(c.req.query('limit'), c.req.query('offset'));
    const [{ total }] = await database.select({ total: count() }).from(taskBids).where(eq(taskBids.taskId, taskId));
    const bids = await database
      .select()
      .from(taskBids)
      .where(eq(taskBids.taskId, taskId))
      .orderBy(desc(taskBids.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({ bids, limit, offset, total: Number(total) });
  });

  // POST /api/v1/tasks/:taskId/bids/:bidId/accept — Accept bid
  app.post('/:bidId/accept', requireAuth, withScope('tasks.write'), async (c) => {
    const taskId = c.req.param('taskId') as string;
    const bidId = c.req.param('bidId');
    const agent = c.get('agent');

    const [task] = await database.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    if (!task) return c.json({ error: 'Task not found' }, 404);
    if (task.requesterId !== agent.agent_id) return c.json({ error: 'Not task owner' }, 403);

    const [preflightBid] = await database
      .select()
      .from(taskBids)
      .where(and(eq(taskBids.id, bidId), eq(taskBids.taskId, taskId)))
      .limit(1);
    if (!preflightBid) return c.json({ error: 'Bid not found' }, 404);
    if (preflightBid.status !== BID_STATUS.PENDING) return c.json({ error: 'Bid no longer pending' }, 400);

    const paymentGate = await requirePayment(c, {
      accepts: {
        scheme: 'exact',
        price: microUsdcToUsdPrice(preflightBid.proposedPrice),
        network: getX402Network(),
        payTo: process.env.PLATFORM_WALLET_ADDRESS ?? '0x0000000000000000000000000000000000000000',
      },
      description: `Fund escrow for task ${task.title}`,
      mimeType: 'application/json',
      unpaidResponseBody: () => ({
        contentType: 'application/json',
        body: {
          error: 'Payment required to fund escrow',
          taskId,
          bidId,
          amount: preflightBid.proposedPrice.toString(),
        },
      }),
    });

    if (paymentGate.response) {
      return paymentGate.response;
    }

    const pendingEscrowTxHash = paymentGate.pendingSettlement ? null : createTxHash();

    // Accept this bid, assign the task, and record pending/funded escrow in one transaction.
    const transactionResult = await database.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM tasks WHERE id = ${taskId} FOR UPDATE`);

      const [lockedTask] = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

      if (!lockedTask) {
        return { ok: false, status: 404, body: { error: 'Task not found' } } as const;
      }
      if (lockedTask.requesterId !== agent.agent_id) {
        return { ok: false, status: 403, body: { error: 'Not task owner' } } as const;
      }
      if (![TASK_STATUS.OPEN, TASK_STATUS.BIDDING].includes(lockedTask.status as 'open' | 'bidding')) {
        return { ok: false, status: 400, body: { error: 'Task not accepting bids' } } as const;
      }

      const [bid] = await tx
        .select()
        .from(taskBids)
        .where(and(eq(taskBids.id, bidId), eq(taskBids.taskId, taskId)))
        .limit(1);

      if (!bid) {
        return { ok: false, status: 404, body: { error: 'Bid not found' } } as const;
      }
      if (bid.status !== BID_STATUS.PENDING) {
        return { ok: false, status: 400, body: { error: 'Bid no longer pending' } } as const;
      }

      await tx.update(taskBids).set({ status: BID_STATUS.ACCEPTED }).where(eq(taskBids.id, bidId));
      await tx.update(taskBids).set({ status: BID_STATUS.REJECTED })
        .where(and(eq(taskBids.taskId, taskId), eq(taskBids.status, BID_STATUS.PENDING), ne(taskBids.id, bidId)));

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
        status: paymentGate.pendingSettlement ? ESCROW_STATUS.PENDING : ESCROW_STATUS.FUNDED,
        escrowTxHash: pendingEscrowTxHash,
        network: process.env.X402_NETWORK ?? 'base-sepolia',
      }).returning();

      return { ok: true, updatedTask, escrow, bid } as const;
    });

    if (!transactionResult.ok) {
      return c.json(transactionResult.body, transactionResult.status);
    }

    const { updatedTask, escrow, bid } = transactionResult;
    let settledEscrow = escrow;
    let settlementHeaders: Record<string, string> = {};

    if (paymentGate.pendingSettlement) {
      const settlement = await paymentGate.pendingSettlement.settle({
        taskId,
        bidId,
        acceptedBidId: bid.id,
      });

      if (!settlement.ok) {
        await database.transaction(async (tx) => {
          await tx.update(taskBids).set({ status: BID_STATUS.PENDING }).where(eq(taskBids.id, bid.id));
          await tx.update(taskBids).set({ status: BID_STATUS.PENDING })
            .where(and(eq(taskBids.taskId, taskId), eq(taskBids.status, BID_STATUS.REJECTED)));
          await tx.update(tasks).set({
            assigneeId: null,
            finalPrice: null,
            status: TASK_STATUS.BIDDING,
            updatedAt: new Date(),
          }).where(eq(tasks.id, taskId));
          await tx.update(escrowTransactions).set({
            status: ESCROW_STATUS.FAILED,
            updatedAt: new Date(),
          }).where(eq(escrowTransactions.id, escrow.id));
        });

        return settlement.response;
      }

      settlementHeaders = settlement.headers;
      const [updatedEscrow] = await database.update(escrowTransactions).set({
        status: ESCROW_STATUS.FUNDED,
        escrowTxHash: settlement.transaction,
        updatedAt: new Date(),
      }).where(eq(escrowTransactions.id, escrow.id)).returning();
      settledEscrow = updatedEscrow;
    }

    events.emit(bid.bidderId, {
      type: 'task.assigned',
      data: { taskId, price: bid.proposedPrice.toString() },
    });
    events.emit(agent.agent_id, {
      type: 'payment.escrowed',
      data: { taskId, amount: bid.proposedPrice.toString(), txHash: settledEscrow.escrowTxHash },
    });
    events.broadcast({
      type: 'task.updated',
      data: { taskId, status: TASK_STATUS.ASSIGNED, assigneeId: bid.bidderId },
    });

    return c.json({ task: updatedTask, acceptedBid: bid, escrow: settledEscrow }, 200, settlementHeaders);
  });

  return app;
}

export default createBidsApp();
