import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createMiddleware } from 'hono/factory';
import type { AATPayload } from '@swarmdock/shared';
import { TASK_STATUS, TASK_VISIBILITY } from '@swarmdock/shared';
import { createTasksApp } from '../src/routes/tasks.ts';
import { tasks, taskBids, agents, disputes, taskInvitations } from '../src/db/schema.ts';

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

function noAuth() {
  return createMiddleware(async (_c, next) => {
    await next();
  });
}

function allowScope() {
  return createMiddleware(async (_c, next) => {
    await next();
  });
}

type FakeState = {
  tasks: Array<Record<string, unknown>>;
  bids: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  disputes: Array<Record<string, unknown>>;
  invitations: Array<Record<string, unknown>>;
};

function createFakeDb(state: FakeState) {
  const rowsFor = (table: unknown) => {
    if (table === tasks) return state.tasks;
    if (table === taskBids) return state.bids;
    if (table === agents) return state.agents;
    if (table === disputes) return state.disputes;
    if (table === taskInvitations) return state.invitations;
    throw new Error('Unsupported table');
  };

  class SelectQuery<T extends Record<string, unknown>> implements PromiseLike<T[]> {
    private rows: T[] = [];
    private selectedFields: Record<string, unknown> | null = null;

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

    offset() {
      return this;
    }

    limit(count: number) {
      this.rows = this.rows.slice(0, count);
      return this;
    }

    then<TResult1 = T[], TResult2 = never>(
      onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      if (this.selectedFields && Object.keys(this.selectedFields).length > 0) {
        // Simulate count() by returning the total rows length
        const hasCount = Object.keys(this.selectedFields).some(k => k === 'total');
        if (hasCount) {
          return Promise.resolve([{ total: this.rows.length }] as T[]).then(onfulfilled, onrejected);
        }
      }
      return Promise.resolve(this.rows).then(onfulfilled, onrejected);
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

      if (tableRows.length > 0) {
        Object.assign(tableRows[0], this.values);
        this.affectedRows = [tableRows[0]];
      }

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

  class InsertResult<T extends Record<string, unknown>> implements PromiseLike<void> {
    constructor(private readonly rows: T[]) {}

    returning() {
      return Promise.resolve(this.rows);
    }

    onConflictDoNothing() {
      return Promise.resolve();
    }

    then<TResult1 = void, TResult2 = never>(
      onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(undefined).then(onfulfilled, onrejected);
    }
  }

  class InsertBuilder<T extends Record<string, unknown>> {
    constructor(private readonly table: unknown) {}

    values(payload: Record<string, unknown> | Array<Record<string, unknown>>) {
      const items = Array.isArray(payload) ? payload : [payload];
      const rows: T[] = [];
      for (const item of items) {
        const row = {
          id: `row-${rowsFor(this.table).length + 1}`,
          ...item,
        } as T;
        rowsFor(this.table).push(row);
        rows.push(row);
      }
      return new InsertResult(rows);
    }
  }

  return {
    async execute() {
      return { rows: [] };
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
      return await callback(this);
    },
  };
}

function createMountedTasksApp(
  state: FakeState,
  options: {
    agentId?: string;
    emitted?: Array<{ agentId: string; event: unknown }>;
    broadcast?: Array<unknown>;
    createTaskResult?: { task: Record<string, unknown>; response?: Response; escrow?: unknown; invitedAgentIds?: string[]; settlementHeaders?: Record<string, string> };
    releaseEscrowResult?: { releaseTxHash: string; fee: bigint };
    releaseEscrowError?: string;
    persistSubmissionResult?: { artifacts: unknown[]; files: string[] };
    persistSubmissionError?: string;
  } = {},
) {
  const emitted = options.emitted ?? [];
  const broadcast = options.broadcast ?? [];
  const app = new Hono();
  app.onError((error) => {
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  });
  app.route('/tasks', createTasksApp({
    authMiddleware: authAs(options.agentId ?? 'requester-1'),
    optionalAuthMiddleware: noAuth(),
    requireScope: () => allowScope(),
    eventBus: {
      emit(agentId, event) {
        emitted.push({ agentId, event });
      },
      broadcast(event) {
        broadcast.push(event);
      },
    },
    db: createFakeDb(state) as never,
    releaseEscrow: options.releaseEscrowError
      ? async () => { throw new Error(options.releaseEscrowError); }
      : async () => options.releaseEscrowResult ?? { releaseTxHash: '0xrelease', fee: 315_000n },
    refundEscrow: async () => {},
    verifyTaskOutput: async () => ({ overallScore: 0.95 }),
    shouldEscalate: async () => false,
    sendEscalationNotification: async () => {},
    safeAppendAuditLog: () => {},
    embed: async () => [],
    persistTaskSubmission: options.persistSubmissionError
      ? async () => { throw new Error(options.persistSubmissionError); }
      : async () => options.persistSubmissionResult ?? { artifacts: [{ type: 'text/plain', content: 'result' }], files: [] },
    searchTasksIndex: async () => null,
    fetchOrderedRowsByIds: async () => [],
    createTaskWithOptionalFunding: options.createTaskResult
      ? async () => options.createTaskResult!
      : async (_c, requesterId, data) => ({
          task: {
            id: 'task-new',
            requesterId,
            title: data.title,
            description: data.description,
            skillRequirements: data.skillRequirements,
            budgetMax: BigInt(data.budgetMax),
            finalPrice: null,
            matchingMode: data.matchingMode ?? 'open',
            visibility: data.visibility ?? 'public',
            revealIdentity: true,
            status: TASK_STATUS.OPEN,
          },
        }),
    findSkillMatchedAgents: async () => [],
    createSystemMatchInvitations: async () => {},
    canReadTask: async () => true,
  }));
  return { app, emitted, broadcast };
}

// ---------- GET / ----------

test('GET / returns list of tasks', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      title: 'Build API',
      description: 'Build a REST API',
      status: TASK_STATUS.OPEN,
      visibility: TASK_VISIBILITY.PUBLIC,
      skillRequirements: ['typescript'],
      budgetMax: 5_000_000n,
      createdAt: new Date(),
    }],
    bids: [],
    agents: [],
    disputes: [],
    invitations: [],
  };

  const { app } = createMountedTasksApp(state);
  const response = await app.request('http://swarmdock.test/tasks');

  assert.equal(response.status, 200);
  const body = await response.json() as { tasks: Array<Record<string, unknown>>; total: number };
  assert.ok(Array.isArray(body.tasks));
});

test('GET / returns 400 for invalid query params', async () => {
  const state: FakeState = { tasks: [], bids: [], agents: [], disputes: [], invitations: [] };

  const { app } = createMountedTasksApp(state);
  const response = await app.request('http://swarmdock.test/tasks?limit=invalid');

  assert.equal(response.status, 400);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Invalid query');
});

// ---------- GET /:id ----------

test('GET /:id returns task detail with bids', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: null,
      title: 'Build API',
      description: 'Build a REST API',
      status: TASK_STATUS.OPEN,
      visibility: TASK_VISIBILITY.PUBLIC,
      revealIdentity: true,
    }],
    bids: [{
      id: 'bid-1',
      taskId: 'task-1',
      bidderId: 'agent-1',
      proposedPrice: 3_000_000n,
      status: 'pending',
    }],
    agents: [
      { id: 'requester-1', displayName: 'Requester', trustLevel: 2, status: 'active' },
      { id: 'agent-1', displayName: 'Bidder', trustLevel: 2, status: 'active' },
    ],
    disputes: [],
    invitations: [],
  };

  const { app } = createMountedTasksApp(state);
  const response = await app.request('http://swarmdock.test/tasks/task-1');

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.id, 'task-1');
  assert.equal(body.bidCount, 1);
  assert.ok(Array.isArray(body.bids));
  const bids = body.bids as Array<{ id: string; bidderDisplayName: string }>;
  assert.equal(bids[0]?.id, 'bid-1');
});

test('GET /:id returns 404 for nonexistent task', async () => {
  const state: FakeState = { tasks: [], bids: [], agents: [], disputes: [], invitations: [] };

  const { app } = createMountedTasksApp(state);
  const response = await app.request('http://swarmdock.test/tasks/nonexistent');

  assert.equal(response.status, 404);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Task not found');
});

// ---------- POST / ----------

test('POST / creates task and broadcasts event', async () => {
  const state: FakeState = { tasks: [], bids: [], agents: [], disputes: [], invitations: [] };

  const broadcast: Array<unknown> = [];
  const { app } = createMountedTasksApp(state, { agentId: 'requester-1', broadcast });
  const response = await app.request('http://swarmdock.test/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Build API',
      description: 'Build a REST API with Hono',
      skillRequirements: ['typescript'],
      budgetMax: '5000000',
    }),
  });

  assert.equal(response.status, 201);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.id, 'task-new');
  assert.equal(body.status, TASK_STATUS.OPEN);
  // Should broadcast task.created for public tasks
  assert.equal(broadcast.length, 1);
  assert.equal((broadcast[0] as { type: string }).type, 'task.created');
});

test('POST / returns 400 for invalid body', async () => {
  const state: FakeState = { tasks: [], bids: [], agents: [], disputes: [], invitations: [] };

  const { app } = createMountedTasksApp(state);
  const response = await app.request('http://swarmdock.test/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '' }),
  });

  assert.equal(response.status, 400);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Validation failed');
});

// ---------- POST /:id/start ----------

test('POST /:id/start transitions task from assigned to in_progress', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: 'agent-1',
      status: TASK_STATUS.ASSIGNED,
    }],
    bids: [],
    agents: [],
    disputes: [],
    invitations: [],
  };

  const emitted: Array<{ agentId: string; event: unknown }> = [];
  const broadcast: Array<unknown> = [];
  const { app } = createMountedTasksApp(state, { agentId: 'agent-1', emitted, broadcast });
  const response = await app.request('http://swarmdock.test/tasks/task-1/start', {
    method: 'POST',
  });

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.status, TASK_STATUS.IN_PROGRESS);
  assert.equal(state.tasks[0]?.status, TASK_STATUS.IN_PROGRESS);
  // Should emit task.started to requester
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.agentId, 'requester-1');
  assert.equal((emitted[0]?.event as { type: string }).type, 'task.started');
  assert.equal(broadcast.length, 1);
});

test('POST /:id/start returns 403 when agent is not the assignee', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: 'agent-2',
      status: TASK_STATUS.ASSIGNED,
    }],
    bids: [],
    agents: [],
    disputes: [],
    invitations: [],
  };

  const { app } = createMountedTasksApp(state, { agentId: 'agent-1' });
  const response = await app.request('http://swarmdock.test/tasks/task-1/start', {
    method: 'POST',
  });

  assert.equal(response.status, 403);
});

test('POST /:id/start returns 400 when task is not in assigned status', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: 'agent-1',
      status: TASK_STATUS.OPEN,
    }],
    bids: [],
    agents: [],
    disputes: [],
    invitations: [],
  };

  const { app } = createMountedTasksApp(state, { agentId: 'agent-1' });
  const response = await app.request('http://swarmdock.test/tasks/task-1/start', {
    method: 'POST',
  });

  assert.equal(response.status, 400);
});

// ---------- POST /:id/submit ----------

test('POST /:id/submit transitions task to review with artifacts', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: 'agent-1',
      status: TASK_STATUS.IN_PROGRESS,
    }],
    bids: [],
    agents: [],
    disputes: [],
    invitations: [],
  };

  const emitted: Array<{ agentId: string; event: unknown }> = [];
  const { app } = createMountedTasksApp(state, { agentId: 'agent-1', emitted });
  const response = await app.request('http://swarmdock.test/tasks/task-1/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      artifacts: [{ type: 'text/plain', content: 'Here is the completed work' }],
    }),
  });

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.status, TASK_STATUS.REVIEW);
  assert.equal(state.tasks[0]?.status, TASK_STATUS.REVIEW);
  // Should notify requester
  assert.ok(emitted.some(e => e.agentId === 'requester-1' && (e.event as { type: string }).type === 'task.submitted'));
});

test('POST /:id/submit returns 403 when agent is not the assignee', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: 'agent-2',
      status: TASK_STATUS.IN_PROGRESS,
    }],
    bids: [],
    agents: [],
    disputes: [],
    invitations: [],
  };

  const { app } = createMountedTasksApp(state, { agentId: 'agent-1' });
  const response = await app.request('http://swarmdock.test/tasks/task-1/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      artifacts: [{ type: 'text/plain', content: 'work' }],
    }),
  });

  assert.equal(response.status, 403);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Not assigned to this task');
});

test('POST /:id/submit returns 400 when task is not in progress', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: 'agent-1',
      status: TASK_STATUS.ASSIGNED,
    }],
    bids: [],
    agents: [],
    disputes: [],
    invitations: [],
  };

  const { app } = createMountedTasksApp(state, { agentId: 'agent-1' });
  const response = await app.request('http://swarmdock.test/tasks/task-1/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      artifacts: [{ type: 'text/plain', content: 'work' }],
    }),
  });

  assert.equal(response.status, 400);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Task not in progress');
});

// ---------- POST /:id/approve ----------

test('POST /:id/approve completes task and releases escrow', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: 'agent-1',
      status: TASK_STATUS.REVIEW,
      resultArtifacts: [{ type: 'text/plain', content: 'result' }],
      inputData: null,
    }],
    bids: [],
    agents: [],
    disputes: [],
    invitations: [],
  };

  const emitted: Array<{ agentId: string; event: unknown }> = [];
  const broadcast: Array<unknown> = [];
  const { app } = createMountedTasksApp(state, {
    agentId: 'requester-1',
    emitted,
    broadcast,
    releaseEscrowResult: { releaseTxHash: '0xapproved', fee: 350_000n },
  });
  const response = await app.request('http://swarmdock.test/tasks/task-1/approve', {
    method: 'POST',
  });

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.status, TASK_STATUS.COMPLETED);
  assert.equal(body.releaseTxHash, '0xapproved');
  assert.equal(state.tasks[0]?.status, TASK_STATUS.COMPLETED);
  // Should emit to assignee
  assert.ok(emitted.some(e => e.agentId === 'agent-1' && (e.event as { type: string }).type === 'task.completed'));
});

test('POST /:id/approve returns 403 when non-owner tries to approve', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: 'agent-1',
      status: TASK_STATUS.REVIEW,
    }],
    bids: [],
    agents: [],
    disputes: [],
    invitations: [],
  };

  const { app } = createMountedTasksApp(state, { agentId: 'agent-1' });
  const response = await app.request('http://swarmdock.test/tasks/task-1/approve', {
    method: 'POST',
  });

  assert.equal(response.status, 403);
});

test('POST /:id/approve returns 400 when task is not in review', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: 'agent-1',
      status: TASK_STATUS.IN_PROGRESS,
    }],
    bids: [],
    agents: [],
    disputes: [],
    invitations: [],
  };

  const { app } = createMountedTasksApp(state, { agentId: 'requester-1' });
  const response = await app.request('http://swarmdock.test/tasks/task-1/approve', {
    method: 'POST',
  });

  assert.equal(response.status, 400);
});

test('POST /:id/approve rolls back to review when escrow release fails', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: 'agent-1',
      status: TASK_STATUS.REVIEW,
      resultArtifacts: [],
      inputData: null,
    }],
    bids: [],
    agents: [],
    disputes: [],
    invitations: [],
  };

  const { app } = createMountedTasksApp(state, {
    agentId: 'requester-1',
    releaseEscrowError: 'Insufficient escrow balance',
  });
  const response = await app.request('http://swarmdock.test/tasks/task-1/approve', {
    method: 'POST',
  });

  assert.equal(response.status, 400);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Insufficient escrow balance');
  // Task should be rolled back to review
  assert.equal(state.tasks[0]?.status, TASK_STATUS.REVIEW);
});

// ---------- POST /:id/reject ----------

test('POST /:id/reject returns task to in_progress and notifies assignee', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: 'agent-1',
      status: TASK_STATUS.REVIEW,
      resultArtifacts: [{ type: 'text/plain', content: 'result' }],
    }],
    bids: [],
    agents: [],
    disputes: [],
    invitations: [],
  };

  const emitted: Array<{ agentId: string; event: unknown }> = [];
  const { app } = createMountedTasksApp(state, { agentId: 'requester-1', emitted });
  const response = await app.request('http://swarmdock.test/tasks/task-1/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Incomplete work' }),
  });

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.status, TASK_STATUS.IN_PROGRESS);
  assert.equal(body.resultArtifacts, null);
  assert.equal(body.resultFiles, null);
  assert.equal(state.tasks[0]?.status, TASK_STATUS.IN_PROGRESS);
  // Should emit to assignee
  assert.ok(emitted.some(e => e.agentId === 'agent-1' && (e.event as { type: string }).type === 'task.rejected'));
});

test('POST /:id/reject returns 403 when non-owner tries to reject', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: 'agent-1',
      status: TASK_STATUS.REVIEW,
    }],
    bids: [],
    agents: [],
    disputes: [],
    invitations: [],
  };

  const { app } = createMountedTasksApp(state, { agentId: 'agent-1' });
  const response = await app.request('http://swarmdock.test/tasks/task-1/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Bad work' }),
  });

  assert.equal(response.status, 403);
});

test('POST /:id/reject returns 400 when task is not in review', async () => {
  const state: FakeState = {
    tasks: [{
      id: 'task-1',
      requesterId: 'requester-1',
      assigneeId: 'agent-1',
      status: TASK_STATUS.COMPLETED,
    }],
    bids: [],
    agents: [],
    disputes: [],
    invitations: [],
  };

  const { app } = createMountedTasksApp(state, { agentId: 'requester-1' });
  const response = await app.request('http://swarmdock.test/tasks/task-1/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: 'Bad work' }),
  });

  assert.equal(response.status, 400);
});
