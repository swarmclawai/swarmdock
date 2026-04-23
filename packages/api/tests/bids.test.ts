import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AATPayload } from '@swarmdock/shared';
import { BID_STATUS, ESCROW_STATUS, TASK_STATUS, TASK_VISIBILITY } from '@swarmdock/shared';
import { createBidsApp } from '../src/routes/bids.ts';
import { escrowTransactions, taskBids, tasks } from '../src/db/schema.ts';
import type { canReadTask } from '../src/routes/task-access.ts';

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON() {
  return this.toString();
};

function authAs(agentId: string) {
  return createMiddleware(async (c, next) => {
    const payload: AATPayload = {
      sub: `did:web:swarmdock.ai:agents:${agentId}`,
      agent_id: agentId,
      trust_level: 2,
      scopes: ['tasks.write'],
      iat: 0,
      exp: Number.MAX_SAFE_INTEGER,
    };

    c.set('agent', payload);
    await next();
  });
}

function allowScope() {
  return createMiddleware(async (_c, next) => {
    await next();
  });
}

function noAuth() {
  return createMiddleware(async (_c, next) => {
    await next();
  });
}

type FakeState = {
  tasks: Array<Record<string, unknown>>;
  bids: Array<Record<string, unknown>>;
  escrows: Array<Record<string, unknown>>;
};

function createFakeDb(state: FakeState, options: { failEscrowInsert?: boolean } = {}) {
  const cloneState = () => ({
    tasks: state.tasks.map((row) => ({ ...row })),
    bids: state.bids.map((row) => ({ ...row })),
    escrows: state.escrows.map((row) => ({ ...row })),
  });

  const replaceState = (snapshot: FakeState) => {
    state.tasks.splice(0, state.tasks.length, ...snapshot.tasks);
    state.bids.splice(0, state.bids.length, ...snapshot.bids);
    state.escrows.splice(0, state.escrows.length, ...snapshot.escrows);
  };

  const rowsFor = (table: unknown) => {
    if (table === tasks) return state.tasks;
    if (table === taskBids) return state.bids;
    if (table === escrowTransactions) return state.escrows;
    throw new Error('Unsupported table');
  };

  class SelectQuery<T extends Record<string, unknown>> implements PromiseLike<T[]> {
    private rows: T[] = [];
    private selectedFields: Record<string, unknown> | null = null;
    private limitCount: number | null = null;
    private offsetCount = 0;

    constructor(fields?: Record<string, unknown>) {
      this.selectedFields = fields ?? null;
    }

    from(table: unknown) {
      this.rows = rowsFor(table) as T[];
      return this;
    }

    where() {
      return this;
    }

    orderBy() {
      return this;
    }

    limit(count: number) {
      this.limitCount = count;
      return this;
    }

    offset(count: number) {
      this.offsetCount = count;
      return this;
    }

    then<TResult1 = T[], TResult2 = never>(
      onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      if (this.selectedFields && Object.keys(this.selectedFields).includes('total')) {
        return Promise.resolve([{ total: this.rows.length }] as T[]).then(onfulfilled, onrejected);
      }

      const start = this.offsetCount;
      const end = this.limitCount === null ? undefined : start + this.limitCount;
      return Promise.resolve(this.rows.slice(start, end)).then(onfulfilled, onrejected);
    }
  }

  class UpdateExecutor<T extends Record<string, unknown>> implements PromiseLike<void> {
    private executed = false;
    private affectedRows: T[] = [];

    constructor(
      private readonly table: unknown,
      private readonly values: Record<string, unknown>,
    ) {}

    private apply(): T[] {
      if (this.executed) {
        return this.affectedRows;
      }

      this.executed = true;
      const tableRows = rowsFor(this.table) as T[];

      if (this.table === tasks) {
        Object.assign(tableRows[0], this.values);
        this.affectedRows = [tableRows[0]];
        return this.affectedRows;
      }

      if (this.table === taskBids) {
        if (this.values.status === BID_STATUS.ACCEPTED) {
          const pending = tableRows.find((row) => row.status === BID_STATUS.PENDING);
          if (pending) {
            Object.assign(pending, this.values);
            this.affectedRows = [pending];
          }
          return this.affectedRows;
        }

        if (this.values.status === BID_STATUS.REJECTED) {
          this.affectedRows = tableRows
            .filter((row) => row.status === BID_STATUS.PENDING)
            .map((row) => Object.assign(row, this.values));
          return this.affectedRows;
        }
      }

      this.affectedRows = tableRows.map((row) => Object.assign(row, this.values));
      return this.affectedRows;
    }

    returning() {
      return Promise.resolve(this.apply());
    }

    then<TResult1 = void, TResult2 = never>(
      onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.apply()).then(() => undefined).then(onfulfilled, onrejected);
    }
  }

  class InsertBuilder<T extends Record<string, unknown>> {
    constructor(private readonly table: unknown) {}

    values(payload: Record<string, unknown>) {
      return {
        returning: async () => {
          if (this.table === escrowTransactions && options.failEscrowInsert) {
            throw new Error('escrow funding failed');
          }

          const row = {
            id: this.table === escrowTransactions ? `escrow-${state.escrows.length + 1}` : `row-${Date.now()}`,
            ...payload,
          } as T;
          rowsFor(this.table).push(row);
          return [row];
        },
      };
    }
  }

  return {
    async execute() {
      return { rows: [{}] };
    },
    select(fields?: Record<string, unknown>) {
      return new SelectQuery(fields);
    },
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return {
            where() {
              return new UpdateExecutor(table, values);
            },
          };
        },
      };
    },
    insert(table: unknown) {
      return new InsertBuilder(table);
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

function createMountedBidsApp(
  state: FakeState,
  options: {
    failEscrowInsert?: boolean;
    emitted?: Array<{ agentId: string; event: unknown }>;
    requirePayment?: () => Promise<
      | { pendingSettlement: null; response?: Response }
      | {
          pendingSettlement: {
            settle: () => Promise<
              | { ok: true; transaction: string; network: string; headers: Record<string, string> }
              | { ok: false; response: Response }
            >;
          };
        }
    >;
    optionalViewerAgentId?: string | null;
    canReadTask?: typeof canReadTask;
  } = {},
) {
  const emitted = options.emitted ?? [];
  const app = new Hono();
  app.onError((error) => new Response(JSON.stringify({ error: error.message }), { status: 500 }));
  app.route('/tasks/:taskId/bids', createBidsApp({
    authMiddleware: authAs('requester-1'),
    optionalAuthMiddleware: options.optionalViewerAgentId
      ? authAs(options.optionalViewerAgentId)
      : noAuth(),
    requireScope: () => allowScope(),
    eventBus: {
      emit(agentId, event) {
        emitted.push({ agentId, event });
      },
      broadcast() {
        // no-op for tests
      },
    },
    createTxHash: () => '0xtesthash',
    db: createFakeDb(state, { failEscrowInsert: options.failEscrowInsert }),
    requirePayment: options.requirePayment ?? (async () => ({ pendingSettlement: null })),
    canReadTask: options.canReadTask,
  }));
  return { app, emitted };
}

test('listing bids hides private tasks from unauthorized viewers', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: null,
      title: 'Private task',
      status: TASK_STATUS.OPEN,
      visibility: TASK_VISIBILITY.PRIVATE,
    }],
    bids: [{
      id: 'bid-1',
      taskId: 'task-1',
      bidderId: 'agent-1',
      proposedPrice: 4_500_000n,
      status: BID_STATUS.PENDING,
    }],
    escrows: [],
  };

  const { app } = createMountedBidsApp(state, {
    canReadTask: async () => false,
  });

  const response = await app.request('http://swarmdock.test/tasks/task-1/bids');
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Task not found' });
});

test('listing bids keeps public tasks readable without auth', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: null,
      title: 'Public task',
      status: TASK_STATUS.OPEN,
      visibility: TASK_VISIBILITY.PUBLIC,
    }],
    bids: [{
      id: 'bid-1',
      taskId: 'task-1',
      bidderId: 'agent-1',
      proposedPrice: 4_500_000n,
      status: BID_STATUS.PENDING,
    }],
    escrows: [],
  };

  const { app } = createMountedBidsApp(state, {
    canReadTask: async () => true,
  });

  const response = await app.request('http://swarmdock.test/tasks/task-1/bids');
  assert.equal(response.status, 200);
  const body = await response.json() as { bids: Array<{ id: string }> };
  assert.equal(body.bids.length, 1);
  assert.equal(body.bids[0]?.id, 'bid-1');
});

test('listing bids returns bounded page metadata', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: null,
      title: 'Public task',
      status: TASK_STATUS.OPEN,
      visibility: TASK_VISIBILITY.PUBLIC,
    }],
    bids: [
      {
        id: 'bid-1',
        taskId: 'task-1',
        bidderId: 'agent-1',
        proposedPrice: 4_500_000n,
        status: BID_STATUS.PENDING,
      },
      {
        id: 'bid-2',
        taskId: 'task-1',
        bidderId: 'agent-2',
        proposedPrice: 4_000_000n,
        status: BID_STATUS.PENDING,
      },
      {
        id: 'bid-3',
        taskId: 'task-1',
        bidderId: 'agent-3',
        proposedPrice: 3_500_000n,
        status: BID_STATUS.PENDING,
      },
    ],
    escrows: [],
  };

  const { app } = createMountedBidsApp(state, {
    canReadTask: async () => true,
  });

  const response = await app.request('http://swarmdock.test/tasks/task-1/bids?limit=1&offset=1');
  assert.equal(response.status, 200);
  const body = await response.json() as {
    bids: Array<{ id: string }>;
    limit: number;
    offset: number;
    total: number;
  };
  assert.equal(body.limit, 1);
  assert.equal(body.offset, 1);
  assert.equal(body.total, 3);
  assert.deepEqual(body.bids.map((bid) => bid.id), ['bid-2']);
});

test('accepting a bid assigns the task, rejects competing bids, and funds escrow', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: null,
      finalPrice: null,
      status: TASK_STATUS.BIDDING,
      updatedAt: new Date('2026-03-29T12:00:00.000Z'),
    }],
    bids: [
      {
        id: 'bid-accepted',
        taskId: 'task-1',
        bidderId: 'agent-1',
        proposedPrice: 3_000_000n,
        status: BID_STATUS.PENDING,
      },
      {
        id: 'bid-rejected',
        taskId: 'task-1',
        bidderId: 'agent-2',
        proposedPrice: 4_000_000n,
        status: BID_STATUS.PENDING,
      },
    ],
    escrows: [],
  };

  const { app, emitted } = createMountedBidsApp(state);
  const response = await app.request('http://swarmdock.test/tasks/task-1/bids/bid-accepted/accept', {
    method: 'POST',
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.task.status, TASK_STATUS.ASSIGNED);
  assert.equal(body.task.assigneeId, 'agent-1');
  assert.equal(body.escrow.status, ESCROW_STATUS.FUNDED);
  assert.equal(state.tasks[0]?.assigneeId, 'agent-1');
  assert.equal(state.tasks[0]?.finalPrice, 3_000_000n);
  assert.deepEqual(state.bids.map((bid) => bid.status), [BID_STATUS.ACCEPTED, BID_STATUS.REJECTED]);
  assert.equal(state.escrows.length, 1);
  assert.equal(emitted.length, 2);
});

test('accepting a bid rejects follow-up accepts once the task is already assigned', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: null,
      finalPrice: null,
      status: TASK_STATUS.BIDDING,
      updatedAt: new Date('2026-03-29T12:00:00.000Z'),
    }],
    bids: [
      {
        id: 'bid-accepted',
        taskId: 'task-1',
        bidderId: 'agent-1',
        proposedPrice: 3_000_000n,
        status: BID_STATUS.PENDING,
      },
      {
        id: 'bid-second',
        taskId: 'task-1',
        bidderId: 'agent-2',
        proposedPrice: 4_000_000n,
        status: BID_STATUS.PENDING,
      },
    ],
    escrows: [],
  };

  const { app } = createMountedBidsApp(state);
  const firstResponse = await app.request('http://swarmdock.test/tasks/task-1/bids/bid-accepted/accept', {
    method: 'POST',
  });
  assert.equal(firstResponse.status, 200);

  const secondResponse = await app.request('http://swarmdock.test/tasks/task-1/bids/bid-second/accept', {
    method: 'POST',
  });
  assert.equal(secondResponse.status, 400);
  const body = await secondResponse.json();
  assert.match(body.error, /Task not accepting bids|Bid no longer pending/);
  assert.equal(state.escrows.length, 1);
});

test('accepting a bid rolls task and bid state back when escrow funding fails', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: null,
      finalPrice: null,
      status: TASK_STATUS.BIDDING,
      updatedAt: new Date('2026-03-29T12:00:00.000Z'),
    }],
    bids: [{
      id: 'bid-accepted',
      taskId: 'task-1',
      bidderId: 'agent-1',
      proposedPrice: 3_000_000n,
      status: BID_STATUS.PENDING,
    }],
    escrows: [],
  };

  const original = {
    task: { ...state.tasks[0] },
    bid: { ...state.bids[0] },
  };

  const { app, emitted } = createMountedBidsApp(state, { failEscrowInsert: true });
  const response = await app.request('http://swarmdock.test/tasks/task-1/bids/bid-accepted/accept', {
    method: 'POST',
  });

  assert.equal(response.status, 500);
  assert.deepEqual(state.tasks[0], original.task);
  assert.deepEqual(state.bids[0], original.bid);
  assert.equal(state.escrows.length, 0);
  assert.deepEqual(emitted, []);
});

test('accepting a bid returns 402 when x402 payment is required and missing', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: null,
      finalPrice: null,
      status: TASK_STATUS.BIDDING,
      updatedAt: new Date('2026-03-29T12:00:00.000Z'),
    }],
    bids: [{
      id: 'bid-accepted',
      taskId: 'task-1',
      bidderId: 'agent-1',
      proposedPrice: 3_000_000n,
      status: BID_STATUS.PENDING,
    }],
    escrows: [],
  };

  const { app } = createMountedBidsApp(state, {
    requirePayment: async () => ({
      pendingSettlement: null,
      response: new Response(JSON.stringify({ error: 'Payment required' }), {
        status: 402,
        headers: { 'PAYMENT-REQUIRED': 'mock' },
      }),
    }),
  });

  const response = await app.request('http://swarmdock.test/tasks/task-1/bids/bid-accepted/accept', {
    method: 'POST',
  });

  assert.equal(response.status, 402);
  assert.equal(state.tasks[0]?.assigneeId, null);
  assert.equal(state.tasks[0]?.finalPrice, null);
  assert.equal(state.escrows.length, 0);
});

test('accepting a bid rolls state back when x402 settlement fails after provisional assignment', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: null,
      finalPrice: null,
      status: TASK_STATUS.BIDDING,
      updatedAt: new Date('2026-03-29T12:00:00.000Z'),
    }],
    bids: [
      {
        id: 'bid-accepted',
        taskId: 'task-1',
        bidderId: 'agent-1',
        proposedPrice: 3_000_000n,
        status: BID_STATUS.PENDING,
      },
      {
        id: 'bid-rejected',
        taskId: 'task-1',
        bidderId: 'agent-2',
        proposedPrice: 4_000_000n,
        status: BID_STATUS.PENDING,
      },
    ],
    escrows: [],
  };

  const { app } = createMountedBidsApp(state, {
    requirePayment: async () => ({
      pendingSettlement: {
        settle: async () => ({
          ok: false,
          response: new Response(JSON.stringify({ error: 'settlement failed' }), { status: 402 }),
        }),
      },
    }),
  });

  const response = await app.request('http://swarmdock.test/tasks/task-1/bids/bid-accepted/accept', {
    method: 'POST',
  });

  assert.equal(response.status, 402);
  assert.equal(state.tasks[0]?.assigneeId, null);
  assert.equal(state.tasks[0]?.finalPrice, null);
  assert.equal(state.tasks[0]?.status, TASK_STATUS.BIDDING);
  assert.deepEqual(state.bids.map((bid) => bid.status), [BID_STATUS.PENDING, BID_STATUS.PENDING]);
  assert.equal(state.escrows[0]?.status, ESCROW_STATUS.FAILED);
});
