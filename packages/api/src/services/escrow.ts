import { db } from '../db/client.js';
import { escrowTransactions, tasks, agents, transactions } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { PLATFORM_FEE_PERCENT, ESCROW_STATUS, TRANSACTION_TYPE, TRANSACTION_STATUS } from '@swarmdock/shared';
import { eventBus } from '../lib/events.js';
import { escrowFundedCounter, escrowReleasedCounter, escrowRefundedCounter } from '../lib/metrics.js';
import { createPublicClient, createWalletClient, http, isAddress, getAddress, parseAbi } from 'viem';
import { createLogger } from '../lib/logger.js';

const logger = createLogger({ service: 'escrow' });
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';

const erc20Abi = parseAbi([
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
]);

/** Prefix used for simulated (non-on-chain) transaction hashes. Dev-only — when REQUIRE_ON_CHAIN=1, simulated hashes are never generated. */
export const SIMULATED_TX_PREFIX = 'sim:0x';

/** Generate a simulated tx hash for development when on-chain transfers are not configured. Throws in production. */
export function createSimulatedTxHash(): string {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Simulated transaction hashes are not allowed in production');
  }
  return `${SIMULATED_TX_PREFIX}${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex')}`;
}

export function isSimulatedTx(hash: string): boolean {
  return hash.startsWith(SIMULATED_TX_PREFIX);
}

function requireOnChain(): boolean {
  return process.env.REQUIRE_ON_CHAIN === '1';
}

/** Validate and normalize an EVM wallet address. Throws if invalid or empty. */
function validateWalletAddress(address: string, context: string): `0x${string}` {
  if (!address) {
    throw new Error(`Empty wallet address (${context})`);
  }
  if (!isAddress(address)) {
    throw new Error(`Invalid wallet address: ${address} (${context})`);
  }
  return getAddress(address);
}

/** Attempt on-chain transfer, handling failures according to REQUIRE_ON_CHAIN mode. */
async function attemptTransfer(to: string, amount: bigint, context: string): Promise<string> {
  validateWalletAddress(to, context);

  let onChainTxHash: string | null;
  try {
    onChainTxHash = await transferUsdc(to, amount);
  } catch (error) {
    // RPC failure — always propagate, never silently swallow
    throw new Error(`On-chain transfer failed (${context}): ${error}`, { cause: error });
  }

  if (!onChainTxHash && requireOnChain()) {
    throw new Error(`On-chain transfer not configured but REQUIRE_ON_CHAIN=1 (${context})`);
  }

  return onChainTxHash ?? createSimulatedTxHash();
}

function getChain() {
  return (process.env.X402_NETWORK ?? 'base-sepolia') === 'base' ? base : baseSepolia;
}

/** Canonical USDC contract addresses per chain */
const USDC_ADDRESSES: Record<number, `0x${string}`> = {
  [base.id]: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  [baseSepolia.id]: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
};

function getUsdcContractAddress(): `0x${string}` | undefined {
  if (process.env.USDC_CONTRACT_ADDRESS) {
    return process.env.USDC_CONTRACT_ADDRESS as `0x${string}`;
  }
  return USDC_ADDRESSES[getChain().id];
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
  const finalTxHash = await attemptTransfer(
    process.env.PLATFORM_WALLET_ADDRESS ?? '',
    params.amount,
    `escrow deposit for task ${params.taskId}`,
  );

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

  escrowFundedCounter.add(1, { network: process.env.X402_NETWORK ?? 'base-sepolia' });
  return { id: result.id, txHash: finalTxHash };
}

export async function releaseEscrow(taskId: string): Promise<{ releaseTxHash: string; fee: bigint }> {
  // Phase 1: Lock escrow and compute amounts (DB only, no on-chain call)
  const phase1 = await db.transaction(async (tx) => {
    const lockResult = await tx.execute(
      sql`SELECT id FROM escrow_transactions WHERE task_id = ${taskId} AND status = ${ESCROW_STATUS.FUNDED} LIMIT 1 FOR UPDATE`,
    );
    if (lockResult.rows.length === 0) {
      throw new Error(`No funded escrow found for task ${taskId}`);
    }

    const lockedId = lockResult.rows[0].id as string;
    const [escrow] = await tx
      .select()
      .from(escrowTransactions)
      .where(eq(escrowTransactions.id, lockedId))
      .limit(1);

    const fee = (escrow.amount * BigInt(PLATFORM_FEE_PERCENT)) / 100n;
    const payout = escrow.amount - fee;

    const [payee] = escrow.payeeId
      ? await tx.select({ walletAddress: agents.walletAddress }).from(agents).where(eq(agents.id, escrow.payeeId)).limit(1)
      : [null];

    // Mark as RELEASING to prevent concurrent release/refund attempts
    await tx
      .update(escrowTransactions)
      .set({ status: ESCROW_STATUS.RELEASING, updatedAt: new Date() })
      .where(eq(escrowTransactions.id, lockedId));

    return { escrow, fee, payout, payeeWallet: payee?.walletAddress ?? '' };
  });

  // Phase 2: On-chain transfer (outside DB transaction — irreversible)
  let finalTxHash: string;
  try {
    finalTxHash = await attemptTransfer(
      phase1.payeeWallet,
      phase1.payout,
      `escrow release for task ${taskId}`,
    );
  } catch (error) {
    // Record failure with retry count — worker will retry automatically
    await db
      .update(escrowTransactions)
      .set({
        status: ESCROW_STATUS.RELEASING,
        retryCount: sql`${escrowTransactions.retryCount} + 1`,
        lastError: String(error),
        updatedAt: new Date(),
      })
      .where(eq(escrowTransactions.id, phase1.escrow.id));
    throw error;
  }

  // Phase 3: Record the release in the database
  await db.transaction(async (tx) => {
    await tx
      .update(escrowTransactions)
      .set({
        status: ESCROW_STATUS.RELEASED,
        platformFee: phase1.fee,
        releaseTxHash: finalTxHash,
        updatedAt: new Date(),
      })
      .where(eq(escrowTransactions.id, phase1.escrow.id));

    await tx.insert(transactions).values({
      taskId,
      type: TRANSACTION_TYPE.ESCROW_RELEASE,
      toAgentId: phase1.escrow.payeeId,
      amount: phase1.payout,
      txHash: finalTxHash,
      network: phase1.escrow.network,
      status: TRANSACTION_STATUS.CONFIRMED,
      confirmedAt: new Date(),
    });

    await tx.insert(transactions).values({
      taskId,
      type: TRANSACTION_TYPE.PLATFORM_FEE,
      toAgentId: null,
      amount: phase1.fee,
      txHash: finalTxHash,
      network: phase1.escrow.network,
      status: TRANSACTION_STATUS.CONFIRMED,
      confirmedAt: new Date(),
    });

    if (phase1.escrow.payeeId) {
      await tx
        .update(agents)
        .set({
          earningTotal: sql`COALESCE(${agents.earningTotal}, 0) + ${phase1.payout}`,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, phase1.escrow.payeeId));
    }

    await tx
      .update(tasks)
      .set({
        platformFee: phase1.fee,
        paymentTxId: finalTxHash,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

  });

  // Emit events after successful Phase 3 commit
  if (phase1.escrow.payeeId) {
    eventBus.emit(phase1.escrow.payeeId, {
      type: 'payment.released',
      data: { taskId, amount: phase1.payout.toString(), fee: phase1.fee.toString(), txHash: finalTxHash },
    });
  }

  escrowReleasedCounter.add(1, { network: process.env.X402_NETWORK ?? 'base-sepolia' });
  return { releaseTxHash: finalTxHash, fee: phase1.fee };
}

export async function refundEscrow(taskId: string): Promise<void> {
  // Phase 1: Lock escrow and read payer wallet (DB only, no on-chain call)
  const phase1 = await db.transaction(async (tx) => {
    const lockResult = await tx.execute(
      sql`SELECT id FROM escrow_transactions WHERE task_id = ${taskId} AND status = ${ESCROW_STATUS.FUNDED} LIMIT 1 FOR UPDATE`,
    );
    if (lockResult.rows.length === 0) {
      return null; // Nothing to refund
    }

    const refundLockedId = lockResult.rows[0].id as string;
    const [escrow] = await tx
      .select()
      .from(escrowTransactions)
      .where(eq(escrowTransactions.id, refundLockedId))
      .limit(1);

    const [payer] = await tx.select({ walletAddress: agents.walletAddress }).from(agents).where(eq(agents.id, escrow.payerId)).limit(1);

    // Mark as REFUNDING to prevent concurrent refund attempts
    await tx
      .update(escrowTransactions)
      .set({ status: ESCROW_STATUS.REFUNDING, updatedAt: new Date() })
      .where(eq(escrowTransactions.id, escrow.id));

    return { escrow, payerWallet: payer?.walletAddress ?? '' };
  });

  if (!phase1) return;

  // Phase 2: On-chain transfer (outside DB transaction — irreversible)
  let finalRefundTxHash: string;
  try {
    finalRefundTxHash = await attemptTransfer(
      phase1.payerWallet,
      phase1.escrow.amount,
      `escrow refund for task ${taskId}`,
    );
  } catch (error) {
    // Record failure with retry count — worker will retry automatically
    await db
      .update(escrowTransactions)
      .set({
        status: ESCROW_STATUS.REFUNDING,
        retryCount: sql`${escrowTransactions.retryCount} + 1`,
        lastError: String(error),
        updatedAt: new Date(),
      })
      .where(eq(escrowTransactions.id, phase1.escrow.id));
    throw error;
  }

  // Phase 3: Record the refund in the database
  await db.transaction(async (tx) => {
    await tx
      .update(escrowTransactions)
      .set({
        status: ESCROW_STATUS.REFUNDED,
        releaseTxHash: finalRefundTxHash,
        updatedAt: new Date(),
      })
      .where(eq(escrowTransactions.id, phase1.escrow.id));

    await tx.insert(transactions).values({
      taskId,
      type: TRANSACTION_TYPE.ESCROW_REFUND,
      toAgentId: phase1.escrow.payerId,
      amount: phase1.escrow.amount,
      txHash: finalRefundTxHash,
      network: phase1.escrow.network,
      status: TRANSACTION_STATUS.CONFIRMED,
      confirmedAt: new Date(),
    });
  });

  // Emit events after successful Phase 3 commit
  escrowRefundedCounter.add(1, { network: process.env.X402_NETWORK ?? 'base-sepolia' });
  eventBus.emit(phase1.escrow.payerId, {
    type: 'payment.refunded',
    data: { taskId, amount: phase1.escrow.amount.toString(), txHash: finalRefundTxHash },
  });
}

/**
 * Validate chain configuration at startup.
 * When targeting Base mainnet, require all on-chain infrastructure to be configured.
 */
export function validateChainConfig(): void {
  const chain = getChain();
  const network = process.env.X402_NETWORK ?? 'base-sepolia';

  if (chain.id === base.id) {
    const missing: string[] = [];
    if (process.env.REQUIRE_ON_CHAIN !== '1') missing.push('REQUIRE_ON_CHAIN=1');
    if (!process.env.EVM_RPC_URL) missing.push('EVM_RPC_URL');
    if (!process.env.PLATFORM_WALLET_PRIVATE_KEY) missing.push('PLATFORM_WALLET_PRIVATE_KEY');

    if (missing.length > 0) {
      logger.error(`FATAL: X402_NETWORK=${network} requires: ${missing.join(', ')}`, { network });
      process.exit(1);
    }
    logger.info('Base mainnet configured', { network, usdc: getUsdcContractAddress() });
  } else {
    logger.info('Base Sepolia testnet', { network, usdc: getUsdcContractAddress() ?? 'not set' });
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
    logger.error('on-chain balance query failed', { error: String(err) });
    return null;
  }
}
