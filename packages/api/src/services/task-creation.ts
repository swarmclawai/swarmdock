import type { Context } from 'hono';
import type { TaskCreateInput } from '@swarmdock/shared';
import { ESCROW_STATUS, MATCHING_MODE, TASK_STATUS } from '@swarmdock/shared';
import type { Database } from '../db/client.js';
import { escrowTransactions, tasks } from '../db/schema.js';
import { createSimulatedTxHash } from './escrow.js';
import { getX402Network, microUsdcToUsdPrice, requireX402Payment } from './x402.js';

type TaskCreationDb = Pick<Database, 'insert' | 'transaction'>;

type CreateTaskWithFundingDeps = {
  db: TaskCreationDb;
  createEscrowTxHash: () => string;
  requirePayment: typeof requireX402Payment;
};

type CreatedTaskResult = {
  response?: Response;
  settlementHeaders: Record<string, string>;
  task?: Record<string, unknown>;
  escrow?: Record<string, unknown>;
};

export function requiresTaskPrefunding(input: Pick<TaskCreateInput, 'directAssigneeId' | 'matchingMode'>): boolean {
  return Boolean(input.directAssigneeId) || input.matchingMode === MATCHING_MODE.AUTO;
}

export async function createTaskWithOptionalFunding(
  context: Context,
  requesterId: string,
  input: TaskCreateInput,
  overrides: Partial<CreateTaskWithFundingDeps> = {},
): Promise<CreatedTaskResult> {
  const database = overrides.db;
  const createEscrowTxHash = overrides.createEscrowTxHash ?? createSimulatedTxHash;
  const requirePayment = overrides.requirePayment ?? requireX402Payment;

  if (!database) {
    throw new Error('A database dependency is required to create tasks');
  }

  const directAssigneeId = input.directAssigneeId ?? null;
  const requiresFunding = requiresTaskPrefunding(input);
  const fundedAmount = BigInt(input.budgetMax);

  if (!requiresFunding) {
    const [task] = await database.insert(tasks).values({
      requesterId,
      assigneeId: null,
      title: input.title,
      description: input.description,
      skillRequirements: input.skillRequirements,
      inputData: input.inputData ?? null,
      inputFiles: input.inputFiles.length > 0 ? input.inputFiles : null,
      matchingMode: input.matchingMode,
      budgetMin: input.budgetMin ? BigInt(input.budgetMin) : null,
      budgetMax: BigInt(input.budgetMax),
      deadline: input.deadline ? new Date(input.deadline) : null,
      status: TASK_STATUS.OPEN,
    }).returning();

    return {
      settlementHeaders: {},
      task,
    };
  }

  const taskId = crypto.randomUUID();
  const paymentGate = await requirePayment(context, {
    accepts: {
      scheme: 'exact',
      price: microUsdcToUsdPrice(fundedAmount),
      network: getX402Network(),
      payTo: process.env.PLATFORM_WALLET_ADDRESS ?? '0x0000000000000000000000000000000000000000',
    },
    description: `Fund escrow for task ${input.title}`,
    mimeType: 'application/json',
    unpaidResponseBody: () => ({
      contentType: 'application/json',
      body: {
        error: 'Payment required to fund escrow',
        taskId,
        amount: fundedAmount.toString(),
        matchingMode: input.matchingMode,
        directAssigneeId,
      },
    }),
  });

  if (paymentGate.response) {
    return {
      response: paymentGate.response,
      settlementHeaders: {},
    };
  }

  let escrowTxHash = createEscrowTxHash();
  let settlementHeaders: Record<string, string> = {};
  let settlementNetwork = process.env.X402_NETWORK ?? 'base-sepolia';

  if (paymentGate.pendingSettlement) {
    const settlement = await paymentGate.pendingSettlement.settle({
      taskId,
      amount: fundedAmount.toString(),
      matchingMode: input.matchingMode,
      directAssigneeId,
    });

    if (!settlement.ok) {
      return {
        response: settlement.response,
        settlementHeaders: {},
      };
    }

    escrowTxHash = settlement.transaction;
    settlementHeaders = settlement.headers;
    settlementNetwork = settlement.network;
  }

  const created = await database.transaction(async (tx: TaskCreationDb) => {
    const [task] = await tx.insert(tasks).values({
      id: taskId,
      requesterId,
      assigneeId: directAssigneeId,
      title: input.title,
      description: input.description,
      skillRequirements: input.skillRequirements,
      inputData: input.inputData ?? null,
      inputFiles: input.inputFiles.length > 0 ? input.inputFiles : null,
      matchingMode: input.matchingMode,
      budgetMin: input.budgetMin ? BigInt(input.budgetMin) : null,
      budgetMax: fundedAmount,
      deadline: input.deadline ? new Date(input.deadline) : null,
      finalPrice: fundedAmount,
      status: directAssigneeId ? TASK_STATUS.ASSIGNED : TASK_STATUS.OPEN,
    }).returning();

    const [escrow] = await tx.insert(escrowTransactions).values({
      taskId,
      payerId: requesterId,
      payeeId: directAssigneeId,
      amount: fundedAmount,
      status: ESCROW_STATUS.FUNDED,
      escrowTxHash,
      network: settlementNetwork,
    }).returning();

    return { task, escrow };
  });

  return {
    settlementHeaders,
    task: created.task,
    escrow: created.escrow,
  };
}
