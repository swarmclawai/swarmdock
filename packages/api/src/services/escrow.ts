import { db } from '../db/client.js';
import { escrowTransactions, tasks } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { PLATFORM_FEE_PERCENT, ESCROW_STATUS } from '@swarmdock/shared';
import { eventBus } from '../lib/events.js';

export async function fundEscrow(params: {
  taskId: string;
  payerId: string;
  payeeId: string;
  amount: bigint;
}): Promise<{ id: string; txHash: string | null }> {
  // In MVP with real x402, this would initiate an on-chain transfer.
  // For now, we record the intent and simulate the tx hash.
  // TODO: Integrate actual x402 USDC transfer on Base Sepolia
  const simulatedTxHash = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;

  const [escrow] = await db.insert(escrowTransactions).values({
    taskId: params.taskId,
    payerId: params.payerId,
    payeeId: params.payeeId,
    amount: params.amount,
    status: ESCROW_STATUS.FUNDED,
    escrowTxHash: simulatedTxHash,
    network: process.env.X402_NETWORK ?? 'base-sepolia',
  }).returning();

  eventBus.emit(params.payerId, {
    type: 'payment.escrowed',
    data: { taskId: params.taskId, amount: params.amount.toString(), txHash: simulatedTxHash },
  });

  return { id: escrow.id, txHash: simulatedTxHash };
}

export async function releaseEscrow(taskId: string): Promise<{ releaseTxHash: string; fee: bigint }> {
  const [escrow] = await db
    .select()
    .from(escrowTransactions)
    .where(eq(escrowTransactions.taskId, taskId))
    .limit(1);

  if (!escrow || escrow.status !== ESCROW_STATUS.FUNDED) {
    throw new Error(`No funded escrow found for task ${taskId}`);
  }

  const fee = (escrow.amount * BigInt(PLATFORM_FEE_PERCENT)) / 100n;
  const payout = escrow.amount - fee;

  // TODO: Actual x402 transfer: payout to payee wallet, fee to platform wallet
  const simulatedReleaseTxHash = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;

  await db
    .update(escrowTransactions)
    .set({
      status: ESCROW_STATUS.RELEASED,
      platformFee: fee,
      releaseTxHash: simulatedReleaseTxHash,
      updatedAt: new Date(),
    })
    .where(eq(escrowTransactions.id, escrow.id));

  if (escrow.payeeId) {
    eventBus.emit(escrow.payeeId, {
      type: 'payment.released',
      data: { taskId, amount: payout.toString(), fee: fee.toString(), txHash: simulatedReleaseTxHash },
    });
  }

  return { releaseTxHash: simulatedReleaseTxHash, fee };
}

export async function refundEscrow(taskId: string): Promise<void> {
  const [escrow] = await db
    .select()
    .from(escrowTransactions)
    .where(eq(escrowTransactions.taskId, taskId))
    .limit(1);

  if (!escrow || escrow.status !== ESCROW_STATUS.FUNDED) {
    return; // Nothing to refund
  }

  // TODO: Actual x402 refund transfer
  const simulatedRefundTxHash = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;

  await db
    .update(escrowTransactions)
    .set({
      status: ESCROW_STATUS.REFUNDED,
      releaseTxHash: simulatedRefundTxHash,
      updatedAt: new Date(),
    })
    .where(eq(escrowTransactions.id, escrow.id));

  eventBus.emit(escrow.payerId, {
    type: 'payment.refunded',
    data: { taskId, amount: escrow.amount.toString(), txHash: simulatedRefundTxHash },
  });
}
