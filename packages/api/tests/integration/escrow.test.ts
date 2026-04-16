/**
 * Real-Postgres integration tests for the escrow state machine.
 *
 * Exercises FOR UPDATE locks, the 3-phase commit pattern in releaseEscrow /
 * refundEscrow, on-chain-failure rollback semantics, and state-transition
 * guards — none of which the fake-DB unit tests can cover.
 *
 * Run with `pnpm --filter @swarmdock/api test:integration`. Requires the dev
 * Postgres container (docker-compose) to be reachable; see setup.ts.
 */

import assert from 'node:assert/strict';
import { before, beforeEach, test } from 'node:test';
import { eq, and } from 'drizzle-orm';
import {
  ESCROW_STATUS,
  TRANSACTION_TYPE,
  TRANSACTION_STATUS,
  PLATFORM_FEE_PERCENT,
} from '@swarmdock/shared';
import { setupTestDb, truncateAll, createTestAgent, createTestTask } from './setup.ts';
import {
  fundEscrow,
  releaseEscrow,
  refundEscrow,
  computeReleaseAmounts,
  SIMULATED_TX_PREFIX,
} from '../../src/services/escrow.ts';
import { db } from '../../src/db/client.ts';
import { escrowTransactions, transactions, agents } from '../../src/db/schema.ts';

// A valid checksummed EVM address used as the platform wallet.
// attemptTransfer requires a non-empty, valid address; with no RPC + no
// private key set, transferUsdc returns null and we fall back to a
// simulated tx hash (sim:0x...).
const TEST_PLATFORM_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

before(async () => {
  process.env.PLATFORM_WALLET_ADDRESS = TEST_PLATFORM_ADDRESS;
  // Ensure simulated-tx fallback is allowed (createSimulatedTxHash refuses
  // to run when NODE_ENV === 'production').
  if (process.env.NODE_ENV === 'production') {
    process.env.NODE_ENV = 'test';
  }
  await setupTestDb();
});

beforeEach(async () => {
  await truncateAll();
});

// Convenience: fund a fresh escrow on a fresh task and return the row.
async function seedFundedEscrow(amount = 5_000_000n) {
  const requester = await createTestAgent({ displayName: 'Requester' });
  const assignee = await createTestAgent({ displayName: 'Assignee' });
  const task = await createTestTask(requester.id, {
    assigneeId: assignee.id,
    budgetMax: amount,
    finalPrice: amount,
  });
  const result = await fundEscrow({
    taskId: task.id,
    payerId: requester.id,
    payeeId: assignee.id,
    amount,
  });
  return { requester, assignee, task, escrowId: result.id, txHash: result.txHash };
}

// ─── 1. fundEscrow happy path ────────────────────────────────

test('fundEscrow inserts a FUNDED row and writes an escrow_deposit transaction', async () => {
  const requester = await createTestAgent({ displayName: 'Requester' });
  const assignee = await createTestAgent({ displayName: 'Assignee' });
  const task = await createTestTask(requester.id, { assigneeId: assignee.id });

  const result = await fundEscrow({
    taskId: task.id,
    payerId: requester.id,
    payeeId: assignee.id,
    amount: 5_000_000n,
  });

  assert.ok(result.id, 'returned id should be truthy');
  assert.ok(result.txHash?.startsWith(SIMULATED_TX_PREFIX), 'txHash should be simulated in tests');

  const [escrow] = await db.select().from(escrowTransactions).where(eq(escrowTransactions.id, result.id));
  assert.equal(escrow.status, ESCROW_STATUS.FUNDED);
  assert.equal(escrow.amount, 5_000_000n);
  assert.equal(escrow.payerId, requester.id);
  assert.equal(escrow.payeeId, assignee.id);

  const txRows = await db.select().from(transactions).where(eq(transactions.taskId, task.id));
  assert.equal(txRows.length, 1);
  assert.equal(txRows[0].type, TRANSACTION_TYPE.ESCROW_DEPOSIT);
  assert.equal(txRows[0].status, TRANSACTION_STATUS.CONFIRMED);
});

// ─── 2. releaseEscrow happy path ─────────────────────────────

test('releaseEscrow completes all 3 phases and credits the payee', async () => {
  const { requester, assignee, task } = await seedFundedEscrow(5_000_000n);

  const { releaseTxHash, fee } = await releaseEscrow(task.id);

  assert.ok(releaseTxHash.startsWith(SIMULATED_TX_PREFIX));
  const expectedFee = computeReleaseAmounts(5_000_000n, PLATFORM_FEE_PERCENT).fee;
  assert.equal(fee, expectedFee);

  const [escrow] = await db.select().from(escrowTransactions).where(eq(escrowTransactions.taskId, task.id));
  assert.equal(escrow.status, ESCROW_STATUS.RELEASED, 'escrow should be RELEASED');
  assert.equal(escrow.platformFee, expectedFee);
  assert.equal(escrow.releaseTxHash, releaseTxHash);

  const txRows = await db.select().from(transactions).where(eq(transactions.taskId, task.id));
  // 1 deposit + 1 release + 1 platform_fee
  assert.equal(txRows.length, 3);
  const types = txRows.map((r) => r.type).sort();
  assert.deepEqual(types, [
    TRANSACTION_TYPE.ESCROW_DEPOSIT,
    TRANSACTION_TYPE.ESCROW_RELEASE,
    TRANSACTION_TYPE.PLATFORM_FEE,
  ].sort());

  const [payeeAfter] = await db.select().from(agents).where(eq(agents.id, assignee.id));
  const expectedPayout = 5_000_000n - expectedFee;
  assert.equal(payeeAfter.earningTotal, expectedPayout, 'payee earningTotal should reflect payout');

  // Suppress unused-var lint for fixture
  void requester;
});

// ─── 3. releaseEscrow on-chain failure rolls back to RELEASING ─

test('releaseEscrow on-chain failure leaves escrow at RELEASING with retry metadata', async () => {
  const { task } = await seedFundedEscrow(5_000_000n);

  // Force attemptTransfer to throw by demanding on-chain settlement
  // without configuring a wallet/RPC.
  const original = process.env.REQUIRE_ON_CHAIN;
  process.env.REQUIRE_ON_CHAIN = '1';
  try {
    await assert.rejects(
      () => releaseEscrow(task.id),
      /On-chain transfer not configured but REQUIRE_ON_CHAIN=1/,
    );
  } finally {
    if (original === undefined) delete process.env.REQUIRE_ON_CHAIN;
    else process.env.REQUIRE_ON_CHAIN = original;
  }

  const [escrow] = await db.select().from(escrowTransactions).where(eq(escrowTransactions.taskId, task.id));
  assert.equal(escrow.status, ESCROW_STATUS.RELEASING, 'should remain RELEASING after Phase 2 failure');
  assert.equal(escrow.retryCount, 1, 'retryCount should be incremented');
  assert.ok(escrow.lastError, 'lastError should be populated');

  // Phase 3 writes must NOT have happened.
  const releaseTxRows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.taskId, task.id), eq(transactions.type, TRANSACTION_TYPE.ESCROW_RELEASE)));
  assert.equal(releaseTxRows.length, 0, 'no ESCROW_RELEASE transaction should be written on Phase 2 failure');
});

// ─── 4. releaseEscrow rejects when nothing is FUNDED ─────────

test('releaseEscrow throws when called twice on the same task', async () => {
  const { task } = await seedFundedEscrow();

  await releaseEscrow(task.id); // first call succeeds
  await assert.rejects(
    () => releaseEscrow(task.id),
    /No funded escrow found for task/,
  );
});

// ─── 5. refundEscrow happy path ──────────────────────────────

test('refundEscrow marks escrow REFUNDED and writes an escrow_refund transaction', async () => {
  const { task, requester } = await seedFundedEscrow(3_000_000n);

  await refundEscrow(task.id);

  const [escrow] = await db.select().from(escrowTransactions).where(eq(escrowTransactions.taskId, task.id));
  assert.equal(escrow.status, ESCROW_STATUS.REFUNDED);
  assert.ok(escrow.releaseTxHash?.startsWith(SIMULATED_TX_PREFIX));

  const refundTxRows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.taskId, task.id), eq(transactions.type, TRANSACTION_TYPE.ESCROW_REFUND)));
  assert.equal(refundTxRows.length, 1);
  assert.equal(refundTxRows[0].toAgentId, requester.id);
  assert.equal(refundTxRows[0].amount, 3_000_000n);
});

// ─── 6. refundEscrow is a no-op when nothing is FUNDED ───────

test('refundEscrow returns silently when no FUNDED escrow exists', async () => {
  const requester = await createTestAgent({ displayName: 'Requester' });
  const task = await createTestTask(requester.id);
  // No fund call — table is empty for this task.

  await refundEscrow(task.id); // should resolve, not throw

  const refundTxRows = await db
    .select()
    .from(transactions)
    .where(eq(transactions.taskId, task.id));
  assert.equal(refundTxRows.length, 0, 'no transaction should be written');
});

// ─── 7. Concurrent releaseEscrow calls don't double-release ──

test('concurrent releaseEscrow calls: FOR UPDATE prevents double-release', async () => {
  const { task } = await seedFundedEscrow();

  const results = await Promise.allSettled([releaseEscrow(task.id), releaseEscrow(task.id)]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  assert.equal(fulfilled.length, 1, 'exactly one releaseEscrow should succeed');
  assert.equal(rejected.length, 1, 'the other should be rejected');
  assert.match(
    String((rejected[0] as PromiseRejectedResult).reason),
    /No funded escrow found for task/,
  );

  const [escrow] = await db.select().from(escrowTransactions).where(eq(escrowTransactions.taskId, task.id));
  assert.equal(escrow.status, ESCROW_STATUS.RELEASED);

  const releaseTxRows = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.taskId, task.id), eq(transactions.type, TRANSACTION_TYPE.ESCROW_RELEASE)));
  assert.equal(releaseTxRows.length, 1, 'exactly one ESCROW_RELEASE row should exist');
});

// ─── 8. State guard: cannot release a REFUNDED escrow ────────

test('releaseEscrow throws after the escrow has been REFUNDED', async () => {
  const { task } = await seedFundedEscrow();
  await refundEscrow(task.id);

  await assert.rejects(
    () => releaseEscrow(task.id),
    /No funded escrow found for task/,
  );
});
