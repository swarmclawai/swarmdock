import assert from 'node:assert/strict';
import test from 'node:test';
import { ESCROW_STATUS, MATCHING_MODE, TASK_STATUS, type TaskCreateInput } from '@swarmdock/shared';
import { escrowTransactions, tasks } from '../src/db/schema.ts';
import { createTaskWithOptionalFunding } from '../src/services/task-creation.ts';

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON() {
  return this.toString();
};

type FakeState = {
  tasks: Array<Record<string, unknown>>;
  escrows: Array<Record<string, unknown>>;
};

function createFakeDb(state: FakeState) {
  const cloneState = () => ({
    tasks: state.tasks.map((row) => ({ ...row })),
    escrows: state.escrows.map((row) => ({ ...row })),
  });

  const replaceState = (snapshot: FakeState) => {
    state.tasks.splice(0, state.tasks.length, ...snapshot.tasks);
    state.escrows.splice(0, state.escrows.length, ...snapshot.escrows);
  };

  const rowsFor = (table: unknown) => {
    if (table === tasks) return state.tasks;
    if (table === escrowTransactions) return state.escrows;
    throw new Error('Unsupported table');
  };

  return {
    insert(table: unknown) {
      return {
        values(payload: Record<string, unknown>) {
          return {
            async returning() {
              const row = {
                id: payload.id ?? `${table === tasks ? 'task' : 'escrow'}-${rowsFor(table).length + 1}`,
                ...payload,
              };
              rowsFor(table).push(row);
              return [row];
            },
          };
        },
      };
    },
    async transaction<T>(callback: (tx: ReturnType<typeof createFakeDb>) => Promise<T>) {
      const snapshot = cloneState();

      try {
        return await callback(this);
      } catch (error) {
        replaceState(snapshot);
        throw error;
      }
    },
  };
}

function baseTaskCreateInput(overrides: Partial<TaskCreateInput> = {}): TaskCreateInput {
  return {
    title: 'Ship feature',
    description: 'Build the requested feature',
    skillRequirements: ['typescript'],
    inputData: undefined,
    inputFiles: [],
    matchingMode: MATCHING_MODE.OPEN,
    budgetMin: undefined,
    budgetMax: '4500000',
    deadline: undefined,
    directAssigneeId: undefined,
    ...overrides,
  };
}

test('prefunded direct task creation returns 402 without persisting when payment is missing', async () => {
  const state: FakeState = { tasks: [], escrows: [] };

  const result = await createTaskWithOptionalFunding(
    {} as never,
    'requester-1',
    baseTaskCreateInput({ directAssigneeId: 'agent-1' }),
    {
      db: createFakeDb(state),
      requirePayment: async () => ({
        pendingSettlement: null,
        response: new Response(JSON.stringify({ error: 'Payment required' }), { status: 402 }),
      }),
    },
  );

  assert.equal(result.response?.status, 402);
  assert.deepEqual(state, { tasks: [], escrows: [] });
});

test('prefunded direct task creation assigns the task and funds escrow after settlement', async () => {
  const state: FakeState = { tasks: [], escrows: [] };

  const result = await createTaskWithOptionalFunding(
    {} as never,
    'requester-1',
    baseTaskCreateInput({ directAssigneeId: 'agent-1' }),
    {
      db: createFakeDb(state),
      createEscrowTxHash: () => 'sim:0xtest',
      requirePayment: async () => ({
        pendingSettlement: {
          settle: async () => ({
            ok: true,
            transaction: '0xsettled',
            network: 'base-sepolia',
            headers: { 'x-payment': 'ok' },
          }),
        },
      }),
    },
  );

  assert.equal(result.response, undefined);
  assert.deepEqual(result.settlementHeaders, { 'x-payment': 'ok' });
  assert.equal(state.tasks.length, 1);
  assert.equal(state.escrows.length, 1);
  assert.equal(state.tasks[0]?.status, TASK_STATUS.ASSIGNED);
  assert.equal(state.tasks[0]?.assigneeId, 'agent-1');
  assert.equal(state.tasks[0]?.finalPrice, 4_500_000n);
  assert.equal(state.escrows[0]?.status, ESCROW_STATUS.FUNDED);
  assert.equal(state.escrows[0]?.payeeId, 'agent-1');
  assert.equal(state.escrows[0]?.escrowTxHash, '0xsettled');
});

test('prefunded auto-match task creation keeps the task open and escrow unassigned until matching', async () => {
  const state: FakeState = { tasks: [], escrows: [] };

  const result = await createTaskWithOptionalFunding(
    {} as never,
    'requester-1',
    baseTaskCreateInput({ matchingMode: MATCHING_MODE.AUTO }),
    {
      db: createFakeDb(state),
      createEscrowTxHash: () => 'sim:0xauto',
      requirePayment: async () => ({ pendingSettlement: null }),
    },
  );

  assert.equal(result.response, undefined);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.escrows.length, 1);
  assert.equal(state.tasks[0]?.status, TASK_STATUS.OPEN);
  assert.equal(state.tasks[0]?.assigneeId, null);
  assert.equal(state.tasks[0]?.finalPrice, 4_500_000n);
  assert.equal(state.escrows[0]?.payeeId, null);
  assert.equal(state.escrows[0]?.escrowTxHash, 'sim:0xauto');
});

test('prefunded task creation does not persist when settlement fails', async () => {
  const state: FakeState = { tasks: [], escrows: [] };

  const result = await createTaskWithOptionalFunding(
    {} as never,
    'requester-1',
    baseTaskCreateInput({ matchingMode: MATCHING_MODE.AUTO }),
    {
      db: createFakeDb(state),
      requirePayment: async () => ({
        pendingSettlement: {
          settle: async () => ({
            ok: false,
            response: new Response(JSON.stringify({ error: 'settlement failed' }), { status: 402 }),
          }),
        },
      }),
    },
  );

  assert.equal(result.response?.status, 402);
  assert.deepEqual(state, { tasks: [], escrows: [] });
});
