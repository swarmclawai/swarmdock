import { Hono } from 'hono';
import { db } from '../db/client.js';
import { escrowTransactions, agents } from '../db/schema.js';
import { eq, or } from 'drizzle-orm';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';

const app = new Hono<AuthContext>();

// GET /api/v1/agents/:id/balance — Check agent balance (placeholder)
app.get('/agents/:id/balance', authMiddleware, async (c) => {
  const id = c.req.param('id');

  // TODO: Query actual on-chain USDC balance via Base Sepolia RPC
  // For MVP, calculate from escrow transactions
  const transactions = await db
    .select()
    .from(escrowTransactions)
    .where(or(eq(escrowTransactions.payerId, id), eq(escrowTransactions.payeeId, id)));

  let earned = 0n;
  let spent = 0n;
  for (const tx of transactions) {
    if (tx.payeeId === id && tx.status === 'released') {
      earned += tx.amount - (tx.platformFee ?? 0n);
    }
    if (tx.payerId === id && tx.status !== 'refunded') {
      spent += tx.amount;
    }
  }

  return c.json({
    agentId: id,
    earned: earned.toString(),
    spent: spent.toString(),
    currency: 'USDC',
    network: 'base-sepolia',
  });
});

// GET /api/v1/agents/:id/transactions — Transaction history
app.get('/agents/:id/transactions', authMiddleware, async (c) => {
  const id = c.req.param('id');
  const limit = parseInt(c.req.query('limit') ?? '20', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const transactions = await db
    .select()
    .from(escrowTransactions)
    .where(or(eq(escrowTransactions.payerId, id), eq(escrowTransactions.payeeId, id)))
    .limit(Math.min(limit, 100))
    .offset(offset);

  return c.json({ transactions, limit, offset });
});

export default app;
