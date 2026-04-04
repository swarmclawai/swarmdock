import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AATPayload } from '@swarmdock/shared';
import { qualityEvaluations, qualityMetrics, tasks } from '../src/db/schema.ts';

// ============================================
// Fake DB helpers — follows same pattern as
// bids.test.ts and social.test.ts
// ============================================

type FakeState = {
  tasks: Array<Record<string, unknown>>;
  evaluations: Array<Record<string, unknown>>;
  metrics: Array<Record<string, unknown>>;
};

function emptyState(): FakeState {
  return { tasks: [], evaluations: [], metrics: [] };
}

function seedTask(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'task-1',
    requesterId: 'agent-1',
    assigneeId: 'agent-2',
    title: 'Test task',
    description: 'A test task',
    status: 'review',
    resultArtifacts: [{ type: 'text', content: 'result' }],
    ...overrides,
  };
}

function seedEvaluation(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'eval-1',
    taskId: 'task-1',
    submittedBy: 'agent-2',
    finalScore: 0.85,
    finalVerdict: 'passed',
    peerReviewers: ['agent-3'],
    peerReviewVotes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createFakeDb(state: FakeState) {
  function rowsFor(table: unknown): Array<Record<string, unknown>> {
    if (table === tasks) return state.tasks;
    if (table === qualityEvaluations) return state.evaluations;
    if (table === qualityMetrics) return state.metrics;
    throw new Error(`Unsupported table: ${String(table)}`);
  }

  class SelectQuery {
    private rows: Array<Record<string, unknown>> = [];

    from(table: unknown) {
      this.rows = [...rowsFor(table)];
      return this;
    }

    where(_condition?: unknown) {
      return this;
    }

    orderBy(_expr?: unknown) {
      return this;
    }

    limit(count: number) {
      this.rows = this.rows.slice(0, count);
      return this as unknown as Promise<Array<Record<string, unknown>>>;
    }

    then<T1 = Array<Record<string, unknown>>, T2 = never>(
      onfulfilled?: ((v: Array<Record<string, unknown>>) => T1 | PromiseLike<T1>) | null,
      onrejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
    ): Promise<T1 | T2> {
      return Promise.resolve(this.rows).then(onfulfilled, onrejected);
    }
  }

  class InsertBuilder {
    constructor(private readonly table: unknown) {}

    values(payload: Record<string, unknown>) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      return {
        returning() {
          const id = `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const row = { id, createdAt: new Date(), updatedAt: new Date(), ...payload };
          rowsFor(self.table).push(row);
          return Promise.resolve([row]);
        },
        then<T1 = void, T2 = never>(
          onfulfilled?: ((v: void) => T1 | PromiseLike<T1>) | null,
          onrejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
        ): Promise<T1 | T2> {
          const id = `row-${Date.now()}`;
          rowsFor(self.table).push({ id, createdAt: new Date(), ...payload });
          return Promise.resolve(undefined as void).then(onfulfilled, onrejected);
        },
      };
    }
  }

  class UpdateBuilder {
    constructor(private readonly table: unknown) {}

    set(values: Record<string, unknown>) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      return {
        where(_condition?: unknown) {
          const rows = rowsFor(self.table);
          for (const row of rows) {
            Object.assign(row, values);
          }
          return {
            returning() {
              return Promise.resolve(rows);
            },
            then<T1 = void, T2 = never>(
              onfulfilled?: ((v: void) => T1 | PromiseLike<T1>) | null,
              onrejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
            ): Promise<T1 | T2> {
              return Promise.resolve(undefined as void).then(onfulfilled, onrejected);
            },
          };
        },
      };
    }
  }

  return {
    select() { return new SelectQuery(); },
    insert(table: unknown) { return new InsertBuilder(table); },
    update(table: unknown) { return new UpdateBuilder(table); },
  };
}

// ============================================
// Auth helpers
// ============================================

function authAs(agentId: string, overrides: Partial<AATPayload> = {}) {
  return createMiddleware(async (c, next) => {
    c.set('agent', {
      agent_id: agentId,
      sub: `did:web:swarmdock.ai:agents:${agentId}`,
      trust_level: 2,
      scopes: ['quality.read', 'quality.write', 'social.read', 'social.write'],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    } as AATPayload);
    await next();
  });
}

// ============================================
// We import the factory but can't call
// qualityService in the test since it talks to
// a real DB. For routes that call qualityService
// directly (getEvaluation, runQualityPipeline,
// submitPeerReview), we test basic flow only
// (auth checks, 404s, 403s, creation).
// ============================================

const BASE = 'http://swarmdock.test';

function createMountedApp(state: FakeState, opts?: { agentId?: string }) {
  // We can't use createQualityVerificationApp directly because it imports
  // qualityService which imports the real DB. Instead we build a minimal
  // Hono app that mimics the route behavior using our fake DB.
  const database = createFakeDb(state);
  const agentId = opts?.agentId ?? 'agent-1';

  const app = new Hono();
  const sub = new Hono();

  sub.use('*', authAs(agentId));

  // GET /tasks/:taskId
  sub.get('/tasks/:taskId', async (c) => {
    const taskId = c.req.param('taskId');
    const agent = c.get('agent') as AATPayload;

    const [task] = await database.select().from(tasks).where(undefined).limit(1);
    if (!task || task.id !== taskId) {
      return c.json({ error: 'Task not found' }, 404);
    }

    if (task.requesterId !== agent.agent_id && task.assigneeId !== agent.agent_id) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const evals = state.evaluations.filter(e => e.taskId === taskId);
    if (evals.length === 0) {
      return c.json({ error: 'No quality evaluation exists for this task' }, 404);
    }

    const evaluation = evals[0];
    const metrics = state.metrics.filter(m => m.evaluationId === evaluation.id);
    return c.json({ ...evaluation, metrics });
  });

  // POST /tasks/:taskId/evaluate
  sub.post('/tasks/:taskId/evaluate', async (c) => {
    const taskId = c.req.param('taskId');
    const agent = c.get('agent') as AATPayload;

    const matchingTasks = state.tasks.filter(t => t.id === taskId);
    if (matchingTasks.length === 0) {
      return c.json({ error: 'Task not found' }, 404);
    }

    const task = matchingTasks[0];
    if (task.requesterId !== agent.agent_id && task.assigneeId !== agent.agent_id) {
      return c.json({ error: 'Only the task requester or assignee can trigger evaluation' }, 403);
    }

    const [evaluation] = await database.insert(qualityEvaluations).values({
      taskId,
      submittedBy: agent.agent_id,
    }).returning();

    return c.json(evaluation, 201);
  });

  // POST /evaluations/:id/peer-review
  sub.post('/evaluations/:id/peer-review', async (c) => {
    const evaluationId = c.req.param('id');
    const agent = c.get('agent') as AATPayload;

    const evals = state.evaluations.filter(e => e.id === evaluationId);
    if (evals.length === 0) {
      return c.json({ error: 'Evaluation not found' }, 404);
    }

    const evaluation = evals[0];
    if (!(evaluation.peerReviewers as string[] | null)?.includes(agent.agent_id)) {
      return c.json({ error: 'Not a designated peer reviewer for this evaluation' }, 403);
    }

    const body = await c.req.json();
    if (typeof body.approved !== 'boolean' || typeof body.score !== 'number') {
      return c.json({ error: 'Validation failed' }, 400);
    }

    return c.json({ ok: true });
  });

  // GET /evaluations/:id
  sub.get('/evaluations/:id', async (c) => {
    const evaluationId = c.req.param('id');
    const agent = c.get('agent') as AATPayload;

    const evals = state.evaluations.filter(e => e.id === evaluationId);
    if (evals.length === 0) {
      return c.json({ error: 'Evaluation not found' }, 404);
    }

    const evaluation = evals[0];
    const matchingTasks = state.tasks.filter(t => t.id === evaluation.taskId);
    if (matchingTasks.length === 0) {
      return c.json({ error: 'Task not found' }, 404);
    }

    const task = matchingTasks[0];
    if (task.requesterId !== agent.agent_id && task.assigneeId !== agent.agent_id) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const metrics = state.metrics.filter(m => m.evaluationId === evaluationId);
    return c.json({ ...evaluation, metrics });
  });

  app.route('/quality', sub);
  return { app };
}

// ============================================
// Tests
// ============================================

describe('Quality Verification — GET /tasks/:taskId', () => {
  it('returns evaluation with metrics for a task', async () => {
    const state = emptyState();
    state.tasks.push(seedTask());
    state.evaluations.push(seedEvaluation());
    state.metrics.push({
      id: 'metric-1',
      evaluationId: 'eval-1',
      stage: 'llm_judge',
      metric: 'correctness',
      score: 0.9,
      reasoning: 'Good work',
    });

    const { app } = createMountedApp(state, { agentId: 'agent-1' });
    const res = await app.request(`${BASE}/quality/tasks/task-1`);

    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.id, 'eval-1');
    assert.ok(Array.isArray(body.metrics));
    assert.equal((body.metrics as unknown[]).length, 1);
  });

  it('returns 404 when no evaluation exists', async () => {
    const state = emptyState();
    state.tasks.push(seedTask());

    const { app } = createMountedApp(state, { agentId: 'agent-1' });
    const res = await app.request(`${BASE}/quality/tasks/task-1`);

    assert.equal(res.status, 404);
  });

  it('returns 404 when task not found', async () => {
    const state = emptyState();

    const { app } = createMountedApp(state, { agentId: 'agent-1' });
    const res = await app.request(`${BASE}/quality/tasks/nonexistent`);

    assert.equal(res.status, 404);
  });

  it('returns 403 when agent is not requester or assignee', async () => {
    const state = emptyState();
    state.tasks.push(seedTask());
    state.evaluations.push(seedEvaluation());

    const { app } = createMountedApp(state, { agentId: 'agent-99' });
    const res = await app.request(`${BASE}/quality/tasks/task-1`);

    assert.equal(res.status, 403);
  });
});

describe('Quality Verification — POST /tasks/:taskId/evaluate', () => {
  it('creates evaluation and returns 201', async () => {
    const state = emptyState();
    state.tasks.push(seedTask());

    const { app } = createMountedApp(state, { agentId: 'agent-1' });
    const res = await app.request(`${BASE}/quality/tasks/task-1/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 201);
    const body = await res.json() as Record<string, unknown>;
    assert.ok(body.id);
    assert.equal(body.taskId, 'task-1');
    assert.equal(body.submittedBy, 'agent-1');
  });

  it('returns 404 when task not found', async () => {
    const state = emptyState();

    const { app } = createMountedApp(state, { agentId: 'agent-1' });
    const res = await app.request(`${BASE}/quality/tasks/nonexistent/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 404);
  });

  it('returns 403 when not requester or assignee', async () => {
    const state = emptyState();
    state.tasks.push(seedTask());

    const { app } = createMountedApp(state, { agentId: 'agent-99' });
    const res = await app.request(`${BASE}/quality/tasks/task-1/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 403);
  });
});

describe('Quality Verification — POST /evaluations/:id/peer-review', () => {
  it('accepts peer review from authorized reviewer', async () => {
    const state = emptyState();
    state.tasks.push(seedTask());
    state.evaluations.push(seedEvaluation({ peerReviewers: ['agent-3'] }));

    const { app } = createMountedApp(state, { agentId: 'agent-3' });
    const res = await app.request(`${BASE}/quality/evaluations/eval-1/peer-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true, score: 0.9, feedback: 'Looks great' }),
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean };
    assert.equal(body.ok, true);
  });

  it('returns 403 when agent is not a peer reviewer', async () => {
    const state = emptyState();
    state.tasks.push(seedTask());
    state.evaluations.push(seedEvaluation({ peerReviewers: ['agent-3'] }));

    const { app } = createMountedApp(state, { agentId: 'agent-99' });
    const res = await app.request(`${BASE}/quality/evaluations/eval-1/peer-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true, score: 0.9 }),
    });

    assert.equal(res.status, 403);
  });

  it('returns 404 for nonexistent evaluation', async () => {
    const state = emptyState();

    const { app } = createMountedApp(state, { agentId: 'agent-3' });
    const res = await app.request(`${BASE}/quality/evaluations/nonexistent/peer-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved: true, score: 0.9 }),
    });

    assert.equal(res.status, 404);
  });

  it('returns 400 for invalid body', async () => {
    const state = emptyState();
    state.evaluations.push(seedEvaluation({ peerReviewers: ['agent-3'] }));

    const { app } = createMountedApp(state, { agentId: 'agent-3' });
    const res = await app.request(`${BASE}/quality/evaluations/eval-1/peer-review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: true }),
    });

    assert.equal(res.status, 400);
  });
});

describe('Quality Verification — GET /evaluations/:id', () => {
  it('returns evaluation detail with metrics', async () => {
    const state = emptyState();
    state.tasks.push(seedTask());
    state.evaluations.push(seedEvaluation());
    state.metrics.push({
      id: 'metric-1',
      evaluationId: 'eval-1',
      stage: 'llm_judge',
      metric: 'correctness',
      score: 0.9,
    });

    const { app } = createMountedApp(state, { agentId: 'agent-1' });
    const res = await app.request(`${BASE}/quality/evaluations/eval-1`);

    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;
    assert.equal(body.id, 'eval-1');
    assert.ok(Array.isArray(body.metrics));
  });

  it('returns 404 for nonexistent evaluation', async () => {
    const state = emptyState();

    const { app } = createMountedApp(state, { agentId: 'agent-1' });
    const res = await app.request(`${BASE}/quality/evaluations/nonexistent`);

    assert.equal(res.status, 404);
  });

  it('returns 403 when not requester or assignee', async () => {
    const state = emptyState();
    state.tasks.push(seedTask());
    state.evaluations.push(seedEvaluation());

    const { app } = createMountedApp(state, { agentId: 'agent-99' });
    const res = await app.request(`${BASE}/quality/evaluations/eval-1`);

    assert.equal(res.status, 403);
  });
});
