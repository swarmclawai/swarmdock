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
  'function balanceOf(address owner) view returns (uint256)',
]);

/** Prefix used for simulated (non-on-chain) transaction hashes */
export const SIMULATED_TX_PREFIX = 'sim:0x';

function createSimulatedTxHash(): string {
  return `${SIMULATED_TX_PREFIX}${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
}

export function isSimulatedTx(hash: string): boolean {
  return hash.startsWith(SIMULATED_TX_PREFIX);
}

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
  // Attempt on-chain USDC deposit when configured
  const onChainTxHash = await transferUsdc(
    process.env.PLATFORM_WALLET_ADDRESS ?? '',
    params.amount,
  ).catch((error) => {
    console.error('[ESCROW] on-chain deposit failed, recording simulated hash:', error);
    return null;
  });

  const finalTxHash = onChainTxHash ?? createSimulatedTxHash();

  const result = await db.transaction(async (tx) => {
    const [escrow] = await tx.insert(escrowTransactions).values({
      taskId: params.taskId,
      payerId: params.payerId,
      payeeId: params.payeeId,
      amount: params.amount,
      status: ESCROW_STATUS.FUNDED,
      escrowTxHash: finalTxHash,
      network: process.env.X402_NETWORK ?? 'base-sepolia',
    }).returning();

    await tx.insert(transactions).values({
      taskId: params.taskId,
      type: TRANSACTION_TYPE.ESCROW_DEPOSIT,
      fromAgentId: params.payerId,
      amount: params.amount,
      txHash: finalTxHash,
      network: process.env.X402_NETWORK ?? 'base-sepolia',
      status: TRANSACTION_STATUS.CONFIRMED,
      confirmedAt: new Date(),
    });

    return { id: escrow.id };
  });

  eventBus.emit(params.payerId, {
    type: 'payment.escrowed',
    data: { taskId: params.taskId, amount: params.amount.toString(), txHash: finalTxHash },
  });

  return { id: result.id, txHash: finalTxHash };
}

export async function releaseEscrow(taskId: string): Promise<{ releaseTxHash: string; fee: bigint }> {
  const result = await db.transaction(async (tx) => {
    // Lock escrow row to prevent concurrent releases
    const lockResult = await tx.execute(
      sql`SELECT id FROM escrow_transactions WHERE task_id = ${taskId} AND status = ${ESCROW_STATUS.FUNDED} LIMIT 1 FOR UPDATE`,
    );
    if (lockResult.rows.length === 0) {
      throw new Error(`No funded escrow found for task ${taskId}`);
    }

    const [escrow] = await tx
      .select()
      .from(escrowTransactions)
      .where(eq(escrowTransactions.taskId, taskId))
      .limit(1);

    const fee = (escrow.amount * BigInt(PLATFORM_FEE_PERCENT)) / 100n;
    const payout = escrow.amount - fee;

    const [payee] = escrow.payeeId
      ? await tx.select({ walletAddress: agents.walletAddress }).from(agents).where(eq(agents.id, escrow.payeeId)).limit(1)
      : [null];

    const onChainTxHash = payee?.walletAddress
      ? await transferUsdc(payee.walletAddress, payout).catch((error) => {
          console.error('[ESCROW] on-chain release failed, falling back to simulated hash:', error);
          return null;
        })
      : null;

    const finalTxHash = onChainTxHash ?? createSimulatedTxHash();

    await tx
      .update(escrowTransactions)
      .set({
        status: ESCROW_STATUS.RELEASED,
        platformFee: fee,
        releaseTxHash: finalTxHash,
        updatedAt: new Date(),
      })
      .where(eq(escrowTransactions.id, escrow.id));

    await tx.insert(transactions).values({
      taskId,
      type: TRANSACTION_TYPE.ESCROW_RELEASE,
      toAgentId: escrow.payeeId,
      amount: payout,
      txHash: finalTxHash,
      network: escrow.network,
      status: TRANSACTION_STATUS.CONFIRMED,
      confirmedAt: new Date(),
    });

    await tx.insert(transactions).values({
      taskId,
      type: TRANSACTION_TYPE.PLATFORM_FEE,
      toAgentId: null,
      amount: fee,
      txHash: finalTxHash,
      network: escrow.network,
      status: TRANSACTION_STATUS.CONFIRMED,
      confirmedAt: new Date(),
    });

    if (escrow.payeeId) {
      await tx
        .update(agents)
        .set({
          earningTotal: sql`COALESCE(${agents.earningTotal}, 0) + ${payout}`,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, escrow.payeeId));
    }

    await tx
      .update(tasks)
      .set({
        platformFee: fee,
        paymentTxId: finalTxHash,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    return { releaseTxHash: finalTxHash, fee, payout, payeeId: escrow.payeeId };
  });

  // Emit events after successful transaction commit
  if (result.payeeId) {
    eventBus.emit(result.payeeId, {
      type: 'payment.released',
      data: { taskId, amount: result.payout.toString(), fee: result.fee.toString(), txHash: result.releaseTxHash },
    });
  }

  return { releaseTxHash: result.releaseTxHash, fee: result.fee };
}

export async function refundEscrow(taskId: string): Promise<void> {
  const result = await db.transaction(async (tx) => {
    // Lock escrow row to prevent concurrent refunds
    const lockResult = await tx.execute(
      sql`SELECT id FROM escrow_transactions WHERE task_id = ${taskId} AND status = ${ESCROW_STATUS.FUNDED} LIMIT 1 FOR UPDATE`,
    );
    if (lockResult.rows.length === 0) {
      return null; // Nothing to refund
    }

    const [escrow] = await tx
      .select()
      .from(escrowTransactions)
      .where(eq(escrowTransactions.taskId, taskId))
      .limit(1);

    const [payer] = await tx.select({ walletAddress: agents.walletAddress }).from(agents).where(eq(agents.id, escrow.payerId)).limit(1);

    const onChainTxHash = payer?.walletAddress
      ? await transferUsdc(payer.walletAddress, escrow.amount).catch((error) => {
          console.error('[ESCROW] on-chain refund failed, falling back to simulated hash:', error);
          return null;
        })
      : null;

    const finalRefundTxHash = onChainTxHash ?? createSimulatedTxHash();

    await tx
      .update(escrowTransactions)
      .set({
        status: ESCROW_STATUS.REFUNDED,
        releaseTxHash: finalRefundTxHash,
        updatedAt: new Date(),
      })
      .where(eq(escrowTransactions.id, escrow.id));

    await tx.insert(transactions).values({
      taskId,
      type: TRANSACTION_TYPE.ESCROW_REFUND,
      toAgentId: escrow.payerId,
      amount: escrow.amount,
      txHash: finalRefundTxHash,
      network: escrow.network,
      status: TRANSACTION_STATUS.CONFIRMED,
      confirmedAt: new Date(),
    });

    return { payerId: escrow.payerId, amount: escrow.amount, txHash: finalRefundTxHash };
  });

  // Emit events after successful transaction commit
  if (result) {
    eventBus.emit(result.payerId, {
      type: 'payment.refunded',
      data: { taskId, amount: result.amount.toString(), txHash: result.txHash },
    });
  }
}

/**
 * Query on-chain USDC balance for a wallet address.
 * Returns null if RPC or contract address is not configured.
 */
export async function queryOnChainBalance(walletAddress: string): Promise<bigint | null> {
  const usdc = getUsdcContractAddress();
  if (!usdc || !process.env.EVM_RPC_URL) return null;

  try {
    const chain = getChain();
    const publicClient = createPublicClient({
      chain,
      transport: http(process.env.EVM_RPC_URL),
    });

    const balance = await publicClient.readContract({
      address: usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [walletAddress as `0x${string}`],
    });

    return balance as bigint;
  } catch (err) {
    console.error('[ESCROW] on-chain balance query failed:', err);
    return null;
  }
}
