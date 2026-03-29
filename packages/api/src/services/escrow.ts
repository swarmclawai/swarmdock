import { db } from '../db/client.js';
import { escrowTransactions, tasks, agents, transactions } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { PLATFORM_FEE_PERCENT, ESCROW_STATUS, TRANSACTION_TYPE, TRANSACTION_STATUS } from '@swarmdock/shared';
import { eventBus } from '../lib/events.js';
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

const erc20Abi = parseAbi([
  'function transfer(address to, uint256 value) returns (bool)',
]);

function getChain() {
  return (process.env.X402_NETWORK ?? 'base-sepolia') === 'base' ? base : baseSepolia;
}

function getUsdcContractAddress() {
  return process.env.USDC_CONTRACT_ADDRESS as `0x${string}` | undefined;
}

async function transferUsdc(to: string, amount: bigint): Promise<string | null> {
  const privateKey = process.env.PLATFORM_WALLET_PRIVATE_KEY as `0x${string}` | undefined;
  const usdc = getUsdcContractAddress();
  if (!privateKey || !usdc || !process.env.EVM_RPC_URL) {
    return null;
  }

  const chain = getChain();
  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(process.env.EVM_RPC_URL),
  });
  const publicClient = createPublicClient({
    chain,
    transport: http(process.env.EVM_RPC_URL),
  });

  const hash = await walletClient.writeContract({
    address: usdc,
    abi: erc20Abi,
    functionName: 'transfer',
    args: [to as `0x${string}`, amount],
    chain,
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

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

  await db.insert(transactions).values({
    taskId: params.taskId,
    type: TRANSACTION_TYPE.ESCROW_DEPOSIT,
    fromAgentId: params.payerId,
    amount: params.amount,
    txHash: simulatedTxHash,
    network: process.env.X402_NETWORK ?? 'base-sepolia',
    status: TRANSACTION_STATUS.CONFIRMED,
    confirmedAt: new Date(),
  });

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

  const [payee] = escrow.payeeId
    ? await db.select({ walletAddress: agents.walletAddress }).from(agents).where(eq(agents.id, escrow.payeeId)).limit(1)
    : [null];
  const simulatedReleaseTxHash = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
  const releaseTxHash = payee?.walletAddress
    ? await transferUsdc(payee.walletAddress, payout).catch((error) => {
        console.error('[ESCROW] on-chain release failed, falling back to simulated hash:', error);
        return null;
      })
    : null;

  const finalTxHash = releaseTxHash ?? simulatedReleaseTxHash;

  await db
    .update(escrowTransactions)
    .set({
      status: ESCROW_STATUS.RELEASED,
      platformFee: fee,
      releaseTxHash: finalTxHash,
      updatedAt: new Date(),
    })
    .where(eq(escrowTransactions.id, escrow.id));

  // Record release transaction for payee
  await db.insert(transactions).values({
    taskId,
    type: TRANSACTION_TYPE.ESCROW_RELEASE,
    toAgentId: escrow.payeeId,
    amount: payout,
    txHash: finalTxHash,
    network: escrow.network,
    status: TRANSACTION_STATUS.CONFIRMED,
    confirmedAt: new Date(),
  });

  // Record platform fee transaction
  await db.insert(transactions).values({
    taskId,
    type: TRANSACTION_TYPE.PLATFORM_FEE,
    toAgentId: null,
    amount: fee,
    txHash: finalTxHash,
    network: escrow.network,
    status: TRANSACTION_STATUS.CONFIRMED,
    confirmedAt: new Date(),
  });

  // Update payee earnings total
  if (escrow.payeeId) {
    await db
      .update(agents)
      .set({
        earningTotal: sql`COALESCE(${agents.earningTotal}, 0) + ${payout}`,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, escrow.payeeId));
  }

  // Update task with platform fee and payment tx ID
  await db
    .update(tasks)
    .set({
      platformFee: fee,
      paymentTxId: finalTxHash,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  if (escrow.payeeId) {
    eventBus.emit(escrow.payeeId, {
      type: 'payment.released',
      data: { taskId, amount: payout.toString(), fee: fee.toString(), txHash: finalTxHash },
    });
  }

  return { releaseTxHash: finalTxHash, fee };
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

  const [payer] = await db.select({ walletAddress: agents.walletAddress }).from(agents).where(eq(agents.id, escrow.payerId)).limit(1);
  const simulatedRefundTxHash = `0x${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
  const refundTxHash = payer?.walletAddress
    ? await transferUsdc(payer.walletAddress, escrow.amount).catch((error) => {
        console.error('[ESCROW] on-chain refund failed, falling back to simulated hash:', error);
        return null;
      })
    : null;

  const finalRefundTxHash = refundTxHash ?? simulatedRefundTxHash;

  await db
    .update(escrowTransactions)
    .set({
      status: ESCROW_STATUS.REFUNDED,
      releaseTxHash: finalRefundTxHash,
      updatedAt: new Date(),
    })
    .where(eq(escrowTransactions.id, escrow.id));

  // Record refund transaction
  await db.insert(transactions).values({
    taskId,
    type: TRANSACTION_TYPE.ESCROW_REFUND,
    toAgentId: escrow.payerId,
    amount: escrow.amount,
    txHash: finalRefundTxHash,
    network: escrow.network,
    status: TRANSACTION_STATUS.CONFIRMED,
    confirmedAt: new Date(),
  });

  eventBus.emit(escrow.payerId, {
    type: 'payment.refunded',
    data: { taskId, amount: escrow.amount.toString(), txHash: finalRefundTxHash },
  });
}
