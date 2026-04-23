import { Hono } from 'hono';
import { db, type Database } from '../db/client.js';
import { escrowTransactions, transactions, agents } from '../db/schema.js';
import { eq, or, desc, sql } from 'drizzle-orm';
import { authMiddleware, type AuthContext } from '../middleware/auth.js';
import { queryOnChainBalance } from '../services/escrow.js';
import { redisGet, redisSet } from '../lib/redis.js';
import { ESCROW_STATUS } from '@swarmdock/shared';
import { parsePagination } from '../lib/pagination.js';

const BALANCE_CACHE_TTL = 30; // seconds

type PaymentsDeps = {
  db: Pick<Database, 'select' | 'execute'>;
  authMiddleware: typeof authMiddleware;
};

type BalanceAggregateRow = {
  earned?: string | number | bigint | null;
  spent?: string | number | bigint | null;
  escrowed?: string | number | bigint | null;
  released?: string | number | bigint | null;
};

export function canAccessAgentPayments(requestedAgentId: string, viewerAgentId: string): boolean {
  return requestedAgentId === viewerAgentId;
}

export function summarizeAgentBalance(
  agentId: string,
  escrowTxs: Array<{
    payerId: string;
    payeeId: string | null;
    amount: bigint;
    platformFee: bigint | null;
    status: string;
  }>,
) {
  let earned = 0n;
  let spent = 0n;
  let escrowed = 0n;
  let released = 0n;

  for (const tx of escrowTxs) {
    if (tx.payeeId === agentId && tx.status === ESCROW_STATUS.RELEASED) {
      const payout = tx.amount - (tx.platformFee ?? 0n);
      earned += payout;
      released += payout;
    }

    if (tx.payerId === agentId && (tx.status === ESCROW_STATUS.FUNDED || tx.status === ESCROW_STATUS.RELEASED)) {
      spent += tx.amount;
    }

    if (tx.payerId === agentId && (tx.status === ESCROW_STATUS.PENDING || tx.status === ESCROW_STATUS.FUNDED)) {
      escrowed += tx.amount;
    }
  }

  return {
    earned: earned.toString(),
    spent: spent.toString(),
    escrowed: escrowed.toString(),
    released: released.toString(),
  };
}

export function summarizeAgentBalanceAggregate(row: BalanceAggregateRow | undefined) {
  const toAmountString = (value: BalanceAggregateRow[keyof BalanceAggregateRow]) => {
    if (value === null || value === undefined) {
      return '0';
    }
    return BigInt(String(value)).toString();
  };

  return {
    earned: toAmountString(row?.earned),
    spent: toAmountString(row?.spent),
    escrowed: toAmountString(row?.escrowed),
    released: toAmountString(row?.released),
  };
}

export function createPaymentsApp(overrides: Partial<PaymentsDeps> = {}) {
  const database = overrides.db ?? db;
  const requireAuth = overrides.authMiddleware ?? authMiddleware;
  const app = new Hono<AuthContext>();
  const settlementNetwork = process.env.X402_NETWORK ?? 'base-sepolia';

  // GET /api/v1/agents/:id/balance — Check agent balance
  app.get('/agents/:id/balance', requireAuth, async (c) => {
    const id = c.req.param('id');
    const agent = c.get('agent');

    if (!canAccessAgentPayments(id, agent.agent_id)) {
      return c.json({ error: 'Can only view your own balance' }, 403);
    }

    const balanceRows = await database.execute(sql`
      SELECT
        COALESCE(SUM(CASE
          WHEN ${escrowTransactions.payeeId} = ${id}
            AND ${escrowTransactions.status} = ${ESCROW_STATUS.RELEASED}
          THEN ${escrowTransactions.amount} - COALESCE(${escrowTransactions.platformFee}, 0)
          ELSE 0
        END), 0)::text AS earned,
        COALESCE(SUM(CASE
          WHEN ${escrowTransactions.payerId} = ${id}
            AND ${escrowTransactions.status} IN (${ESCROW_STATUS.FUNDED}, ${ESCROW_STATUS.RELEASED})
          THEN ${escrowTransactions.amount}
          ELSE 0
        END), 0)::text AS spent,
        COALESCE(SUM(CASE
          WHEN ${escrowTransactions.payerId} = ${id}
            AND ${escrowTransactions.status} IN (${ESCROW_STATUS.PENDING}, ${ESCROW_STATUS.FUNDED})
          THEN ${escrowTransactions.amount}
          ELSE 0
        END), 0)::text AS escrowed,
        COALESCE(SUM(CASE
          WHEN ${escrowTransactions.payeeId} = ${id}
            AND ${escrowTransactions.status} = ${ESCROW_STATUS.RELEASED}
          THEN ${escrowTransactions.amount} - COALESCE(${escrowTransactions.platformFee}, 0)
          ELSE 0
        END), 0)::text AS released
      FROM ${escrowTransactions}
      WHERE ${escrowTransactions.payerId} = ${id}
        OR ${escrowTransactions.payeeId} = ${id}
    `);

    const summary = summarizeAgentBalanceAggregate(balanceRows.rows[0] as BalanceAggregateRow | undefined);

    // Query actual on-chain USDC balance if wallet is configured
    let onChainBalance: string | null = null;
    const refresh = c.req.query('refresh') === 'true';
    const [agentRow] = await database
      .select({ walletAddress: agents.walletAddress })
      .from(agents)
      .where(eq(agents.id, id))
      .limit(1);
    if (agentRow?.walletAddress) {
      const cacheKey = `onchain:balance:${agentRow.walletAddress}`;
      if (!refresh) {
        const cached = await redisGet(cacheKey);
        if (cached !== null) {
          onChainBalance = cached;
        }
      }
      if (onChainBalance === null) {
        const balance = await queryOnChainBalance(agentRow.walletAddress);
        if (balance !== null) {
          onChainBalance = balance.toString();
          await redisSet(cacheKey, onChainBalance, BALANCE_CACHE_TTL);
        }
      }
    }

    return c.json({
      agentId: id,
      earned: summary.earned,
      spent: summary.spent,
      escrowed: summary.escrowed,
      released: summary.released,
      onChainBalance,
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

    const { limit, offset } = parsePagination(c.req.query('limit'), c.req.query('offset'));

    // Query from transactions table first
    const txRows = await database
      .select()
      .from(transactions)
      .where(or(eq(transactions.fromAgentId, id), eq(transactions.toAgentId, id)))
      .orderBy(desc(transactions.createdAt))
      .limit(limit)
      .offset(offset);

    // Fall back to escrow transactions if no rows in new table
    if (txRows.length === 0) {
      const escrowTxs = await database
        .select()
        .from(escrowTransactions)
        .where(or(eq(escrowTransactions.payerId, id), eq(escrowTransactions.payeeId, id)))
        .orderBy(desc(escrowTransactions.createdAt))
        .limit(limit)
        .offset(offset);

      return c.json({ transactions: escrowTxs, limit, offset, source: 'escrow' });
    }

    return c.json({ transactions: txRows, limit, offset });
  });

  return app;
}

export default createPaymentsApp();
