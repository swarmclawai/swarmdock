import { Hono } from 'hono';
import { db, type Database } from '../db/client.js';
import { escrowTransactions } from '../db/schema.js';
import { eq, or } from 'drizzle-orm';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';

type PaymentsDeps = {
  db: Pick<Database, 'select'>;
  authMiddleware: typeof authMiddleware;
};

export function canAccessAgentPayments(requestedAgentId: string, viewerAgentId: string): boolean {
  return requestedAgentId === viewerAgentId;
}

export function createPaymentsApp(overrides: Partial<PaymentsDeps> = {}) {
  const database = overrides.db ?? db;
  const requireAuth = overrides.authMiddleware ?? authMiddleware;
  const app = new Hono<AuthContext>();
  const settlementNetwork = process.env.X402_NETWORK ?? 'base-sepolia';

  // GET /api/v1/agents/:id/balance — Check agent balance (placeholder)
  app.get('/agents/:id/balance', requireAuth, async (c) => {
    const id = c.req.param('id');
    const agent = c.get('agent');

    if (!canAccessAgentPayments(id, agent.agent_id)) {
      return c.json({ error: 'Can only view your own balance' }, 403);
    }

    // TODO: Query actual on-chain USDC balance via Base Sepolia RPC
    // For MVP, calculate from escrow transactions
    const transactions = await database
      .select()
      .from(escrowTransactions)
      .where(or(eq(escrowTransactions.payerId, id), eq(escrowTransactions.payeeId, id)));

    let earned = 0n;
    let spent = 0n;
    let escrowed = 0n;
    let released = 0n;
    for (const tx of transactions) {
      if (tx.payeeId === id && tx.status === 'released') {
        const payout = tx.amount - (tx.platformFee ?? 0n);
        earned += payout;
        released += payout;
      }
      if (tx.payerId === id && tx.status !== 'refunded') {
        spent += tx.amount;
      }
      if (tx.payerId === id && (tx.status === 'pending' || tx.status === 'funded')) {
        escrowed += tx.amount;
      }
    }

    return c.json({
      agentId: id,
      earned: earned.toString(),
      spent: spent.toString(),
      escrowed: escrowed.toString(),
      released: released.toString(),
      currency: 'USDC',
      network: settlementNetwork,
    });
  });

  // GET /api/v1/agents/:id/transactions — Transaction history
  app.get('/agents/:id/transactions', requireAuth, async (c) => {
    const id = c.req.param('id');
    const agent = c.get('agent');

    if (!canAccessAgentPayments(id, agent.agent_id)) {
      return c.json({ error: 'Can only view your own transactions' }, 403);
    }

    const limit = Math.max(1, Math.min(parseInt(c.req.query('limit') ?? '20', 10) || 20, 100));
    const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10) || 0);

    const transactions = await database
      .select()
      .from(escrowTransactions)
      .where(or(eq(escrowTransactions.payerId, id), eq(escrowTransactions.payeeId, id)))
      .limit(Math.min(limit, 100))
      .offset(offset);

    return c.json({ transactions, limit, offset });
  });

  return app;
}

export default createPaymentsApp();
