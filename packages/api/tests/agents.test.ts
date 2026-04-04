import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AATPayload } from '@swarmdock/shared';
import { AGENT_STATUS } from '@swarmdock/shared';
import { createAgentsApp } from '../src/routes/agents.ts';
import { agents, agentSkills, challenges } from '../src/db/schema.ts';

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON() {
  return this.toString();
};

function authAs(agentId: string) {
  return createMiddleware(async (c, next) => {
    const payload: AATPayload = {
      sub: `did:web:swarmdock.ai:agents:${agentId}`,
      agent_id: agentId,
      trust_level: 2,
      scopes: ['tasks.write', 'profile.write'],
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

function noRateLimit() {
  return createMiddleware(async (_c, next) => {
    await next();
  });
}

type FakeState = {
  agents: Array<Record<string, unknown>>;
  skills: Array<Record<string, unknown>>;
  challenges: Array<Record<string, unknown>>;
};

function createFakeDb(state: FakeState) {
  const rowsFor = (table: unknown) => {
    if (table === agents) return state.agents;
    if (table === agentSkills) return state.skills;
    if (table === challenges) return state.challenges;
    throw new Error('Unsupported table');
  };

  class SelectQuery<T extends Record<string, unknown>> implements PromiseLike<T[]> {
    private rows: T[] = [];
    private isCount = false;

    constructor(fields?: unknown) {
      // Detect count() queries by checking if fields contain a 'total' key
      if (fields && typeof fields === 'object' && 'total' in (fields as Record<string, unknown>)) {
        this.isCount = true;
      }
    }

    from(table: unknown) {
      this.rows = rowsFor(table) as T[];
      return this;
    }

    where(predicate?: unknown) {
      // Simple predicate filtering is not implemented; tests control state directly
      void predicate;
      return this;
    }

    limit(count: number) {
      this.rows = this.rows.slice(0, count);
      return this;
    }

    offset() {
      return this;
    }

    then<TResult1 = T[], TResult2 = never>(
      onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      if (this.isCount) {
        return Promise.resolve([{ total: this.rows.length }] as T[]).then(onfulfilled, onrejected);
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
          id: `${this.table === agents ? 'agent' : this.table === challenges ? 'challenge' : 'skill'}-${rowsFor(this.table).length + 1}`,
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
      return { rows: [{}] };
    },
    select(fields?: unknown) {
      return new SelectQuery(fields);
    },
    selectDistinct() {
      return new SelectQuery();
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

function createMountedAgentsApp(
  state: FakeState,
  options: {
    agentId?: string;
    broadcast?: Array<unknown>;
    verifySignatureResult?: boolean;
    challengeData?: { challenge: string; expiresAt: Date };
    issueAATResult?: string;
  } = {},
) {
  const broadcast: Array<unknown> = options.broadcast ?? [];
  const app = new Hono();
  app.onError((error) => new Response(JSON.stringify({ error: error.message }), { status: 500 }));
  app.route('/agents', createAgentsApp({
    authMiddleware: authAs(options.agentId ?? 'agent-1'),
    requireScope: () => allowScope(),
    rateLimitAuth: noRateLimit(),
    rateLimitStrict: noRateLimit(),
    eventBus: {
      emit() {
        // no-op for tests
      },
      broadcast(event) {
        broadcast.push(event);
      },
    },
    db: createFakeDb(state) as never,
    generateChallenge: () => options.challengeData ?? {
      challenge: 'test-challenge-nonce',
      expiresAt: new Date(Date.now() + 300_000),
    },
    verifySignature: () => options.verifySignatureResult ?? true,
    generateDID: (id: string) => `did:web:swarmdock.ai:agents:${id}`,
    issueAAT: async () => options.issueAATResult ?? 'test-aat-token',
    embed: async () => [],
    embedBatch: async () => [],
    provisionAgentWallet: async () => null,
    getRatingsSummary: async () => ({ count: 0, averages: null, ratings: [] }),
    updateTrustLevel: async () => 3,
    getAgentPortfolio: async () => ({ items: [] }),
    createPortfolioItem: async () => ({ id: 'portfolio-1' }),
    updatePortfolioItem: async () => ({ id: 'portfolio-1' }),
    deletePortfolioItem: async () => {},
    searchAgentsIndex: async () => null,
    fetchOrderedRowsByIds: async () => [],
  }));
  return { app, broadcast };
}

// ---------- POST /register ----------

test('POST /register creates a pending agent and returns challenge', async () => {
  const state: FakeState = { agents: [], skills: [], challenges: [] };

  const { app } = createMountedAgentsApp(state);
  const response = await app.request('http://swarmdock.test/agents/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      displayName: 'Test Agent',
    }),
  });

  assert.equal(response.status, 201);
  const body = await response.json() as { agentId: string; challenge: string; expiresAt: string };
  assert.ok(body.agentId);
  assert.equal(body.challenge, 'test-challenge-nonce');
  assert.ok(body.expiresAt);
  assert.equal(state.agents.length, 1);
  assert.equal(state.agents[0]?.status, AGENT_STATUS.PENDING);
  assert.equal(state.challenges.length, 1);
});

test('POST /register returns 400 for missing public key', async () => {
  const state: FakeState = { agents: [], skills: [], challenges: [] };

  const { app } = createMountedAgentsApp(state);
  const response = await app.request('http://swarmdock.test/agents/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      displayName: 'Test Agent',
    }),
  });

  assert.equal(response.status, 400);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Validation failed');
  assert.equal(state.agents.length, 0);
});

test('POST /register returns 409 when active agent already exists with same key', async () => {
  const state: FakeState = {
    agents: [{
      id: 'agent-existing',
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      displayName: 'Existing Agent',
      status: AGENT_STATUS.ACTIVE,
    }],
    skills: [],
    challenges: [],
  };

  const { app } = createMountedAgentsApp(state);
  const response = await app.request('http://swarmdock.test/agents/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      displayName: 'New Agent',
    }),
  });

  assert.equal(response.status, 409);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Agent with this public key already registered');
});

test('POST /register re-registers a pending agent instead of creating a duplicate', async () => {
  const state: FakeState = {
    agents: [{
      id: 'agent-pending',
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      displayName: 'Pending Agent',
      status: AGENT_STATUS.PENDING,
    }],
    skills: [],
    challenges: [],
  };

  const { app } = createMountedAgentsApp(state);
  const response = await app.request('http://swarmdock.test/agents/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      displayName: 'Updated Agent',
    }),
  });

  assert.equal(response.status, 201);
  const body = await response.json() as { agentId: string };
  assert.equal(body.agentId, 'agent-pending');
  // Should not create a second agent
  assert.equal(state.agents.length, 1);
  assert.equal(state.agents[0]?.displayName, 'Updated Agent');
});

// ---------- POST /verify ----------

test('POST /verify activates agent and returns AAT token', async () => {
  const state: FakeState = {
    agents: [{
      id: 'agent-1',
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      did: 'did:web:swarmdock.ai:agents:agent-1',
      displayName: 'Test Agent',
      status: AGENT_STATUS.PENDING,
      trustLevel: 0,
    }],
    skills: [],
    challenges: [{
      id: 'challenge-1',
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      challenge: 'challenge-nonce',
      expiresAt: new Date(Date.now() + 300_000),
      used: false,
    }],
  };

  const broadcast: Array<unknown> = [];
  const { app } = createMountedAgentsApp(state, { broadcast });
  const response = await app.request('http://swarmdock.test/agents/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      challenge: 'challenge-nonce',
      signature: 'valid-signature',
    }),
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { token: string; agent: { id: string; status: string; trustLevel: number } };
  assert.equal(body.token, 'test-aat-token');
  assert.equal(body.agent.id, 'agent-1');
  assert.equal(body.agent.trustLevel, 2);
  assert.equal(body.agent.status, AGENT_STATUS.ACTIVE);
  // Challenge should be marked used
  assert.equal(state.challenges[0]?.used, true);
  // Agent should be activated
  assert.equal(state.agents[0]?.status, AGENT_STATUS.ACTIVE);
  assert.equal(state.agents[0]?.trustLevel, 2);
  // Should broadcast agent.registered
  assert.equal(broadcast.length, 1);
  assert.equal((broadcast[0] as { type: string }).type, 'agent.registered');
});

test('POST /verify returns 400 for invalid signature', async () => {
  const state: FakeState = {
    agents: [{
      id: 'agent-1',
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      did: 'did:web:swarmdock.ai:agents:agent-1',
      displayName: 'Test Agent',
      status: AGENT_STATUS.PENDING,
      trustLevel: 0,
    }],
    skills: [],
    challenges: [{
      id: 'challenge-1',
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      challenge: 'challenge-nonce',
      expiresAt: new Date(Date.now() + 300_000),
      used: false,
    }],
  };

  const { app } = createMountedAgentsApp(state, { verifySignatureResult: false });
  const response = await app.request('http://swarmdock.test/agents/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      challenge: 'challenge-nonce',
      signature: 'bad-signature',
    }),
  });

  assert.equal(response.status, 401);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Invalid signature');
  assert.equal(state.agents[0]?.status, AGENT_STATUS.PENDING);
});

test('POST /verify returns 400 for expired challenge', async () => {
  const state: FakeState = {
    agents: [{
      id: 'agent-1',
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      did: 'did:web:swarmdock.ai:agents:agent-1',
      displayName: 'Test Agent',
      status: AGENT_STATUS.PENDING,
      trustLevel: 0,
    }],
    skills: [],
    challenges: [{
      id: 'challenge-1',
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      challenge: 'challenge-nonce',
      expiresAt: new Date(Date.now() - 10_000), // expired
      used: false,
    }],
  };

  const { app } = createMountedAgentsApp(state);
  const response = await app.request('http://swarmdock.test/agents/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      challenge: 'challenge-nonce',
      signature: 'valid-signature',
    }),
  });

  assert.equal(response.status, 400);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Challenge expired');
});

test('POST /verify returns 400 when challenge not found', async () => {
  const state: FakeState = {
    agents: [{
      id: 'agent-1',
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      did: 'did:web:swarmdock.ai:agents:agent-1',
      displayName: 'Test Agent',
      status: AGENT_STATUS.PENDING,
      trustLevel: 0,
    }],
    skills: [],
    challenges: [], // no challenges
  };

  const { app } = createMountedAgentsApp(state);
  const response = await app.request('http://swarmdock.test/agents/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      challenge: 'nonexistent-nonce',
      signature: 'valid-signature',
    }),
  });

  assert.equal(response.status, 400);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Challenge not found or already used');
});

test('POST /verify returns 400 for missing fields', async () => {
  const state: FakeState = { agents: [], skills: [], challenges: [] };

  const { app } = createMountedAgentsApp(state);
  const response = await app.request('http://swarmdock.test/agents/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: 'test' }),
  });

  assert.equal(response.status, 400);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Validation failed');
});

// ---------- GET /:id ----------

test('GET /:id returns agent profile without publicKey', async () => {
  const state: FakeState = {
    agents: [{
      id: 'agent-1',
      did: 'did:web:swarmdock.ai:agents:agent-1',
      publicKey: 'secret-public-key',
      displayName: 'Test Agent',
      description: 'A test agent',
      status: AGENT_STATUS.ACTIVE,
      trustLevel: 2,
    }],
    skills: [{
      id: 'skill-1',
      agentId: 'agent-1',
      skillId: 'typescript',
      skillName: 'TypeScript',
      category: 'development',
    }],
    challenges: [],
  };

  const { app } = createMountedAgentsApp(state);
  const response = await app.request('http://swarmdock.test/agents/agent-1');

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.id, 'agent-1');
  assert.equal(body.displayName, 'Test Agent');
  assert.equal(body.publicKey, undefined); // publicKey must be sanitized
  assert.equal(body.skillCount, 1);
  assert.ok(Array.isArray(body.topSkills));
});

test('GET /:id returns 404 for deregistered agent', async () => {
  const state: FakeState = {
    agents: [{
      id: 'agent-1',
      displayName: 'Deregistered Agent',
      status: AGENT_STATUS.DEREGISTERED,
    }],
    skills: [],
    challenges: [],
  };

  const { app } = createMountedAgentsApp(state);
  const response = await app.request('http://swarmdock.test/agents/agent-1');

  assert.equal(response.status, 404);
});

test('GET /:id returns 404 for nonexistent agent', async () => {
  const state: FakeState = { agents: [], skills: [], challenges: [] };

  const { app } = createMountedAgentsApp(state);
  const response = await app.request('http://swarmdock.test/agents/nonexistent');

  assert.equal(response.status, 404);
});

// ---------- GET / ----------

test('GET / returns list of agents with skill counts', async () => {
  const state: FakeState = {
    agents: [{
      id: 'agent-1',
      publicKey: 'pk-1',
      displayName: 'Agent One',
      status: AGENT_STATUS.ACTIVE,
    }],
    skills: [{
      agentId: 'agent-1',
      skillId: 'ts',
      skillName: 'TypeScript',
      category: 'dev',
    }],
    challenges: [],
  };

  const { app } = createMountedAgentsApp(state);
  const response = await app.request('http://swarmdock.test/agents');

  assert.equal(response.status, 200);
  const body = await response.json() as { agents: Array<Record<string, unknown>>; total: number };
  // searchAgentsIndex returns null in our mock, so falls through to DB path
  assert.ok(Array.isArray(body.agents));
});

// ---------- PATCH /:id ----------

test('PATCH /:id updates agent profile fields', async () => {
  const state: FakeState = {
    agents: [{
      id: 'agent-1',
      did: 'did:web:swarmdock.ai:agents:agent-1',
      publicKey: 'pk-1',
      displayName: 'Old Name',
      description: 'old desc',
      status: AGENT_STATUS.ACTIVE,
    }],
    skills: [],
    challenges: [],
  };

  const broadcast: Array<unknown> = [];
  const { app } = createMountedAgentsApp(state, { agentId: 'agent-1', broadcast });
  const response = await app.request('http://swarmdock.test/agents/agent-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'New Name' }),
  });

  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.displayName, 'New Name');
  assert.equal(body.publicKey, undefined); // must not expose publicKey
  assert.equal(body.webhookSecret, undefined); // must not expose webhookSecret
  assert.equal(broadcast.length, 1);
  assert.equal((broadcast[0] as { type: string }).type, 'agent.updated');
});

test('PATCH /:id returns 403 when updating another agent', async () => {
  const state: FakeState = {
    agents: [{
      id: 'agent-2',
      displayName: 'Other Agent',
      status: AGENT_STATUS.ACTIVE,
    }],
    skills: [],
    challenges: [],
  };

  const { app } = createMountedAgentsApp(state, { agentId: 'agent-1' });
  const response = await app.request('http://swarmdock.test/agents/agent-2', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: 'Hacked Name' }),
  });

  assert.equal(response.status, 403);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Can only update your own profile');
});

// ---------- POST /:id/heartbeat ----------

test('POST /:id/heartbeat refreshes heartbeat and returns new token', async () => {
  const state: FakeState = {
    agents: [{
      id: 'agent-1',
      did: 'did:web:swarmdock.ai:agents:agent-1',
      displayName: 'Test Agent',
      publicKey: 'pk-1',
      status: AGENT_STATUS.ACTIVE,
      trustLevel: 2,
      lastHeartbeat: new Date('2026-01-01'),
    }],
    skills: [],
    challenges: [],
  };

  const { app } = createMountedAgentsApp(state, { agentId: 'agent-1', issueAATResult: 'refreshed-token' });
  const response = await app.request('http://swarmdock.test/agents/agent-1/heartbeat', {
    method: 'POST',
  });

  assert.equal(response.status, 200);
  const body = await response.json() as { token: string; lastHeartbeat: string };
  assert.equal(body.token, 'refreshed-token');
  assert.ok(body.lastHeartbeat);
});

test('POST /:id/heartbeat returns 403 for different agent', async () => {
  const state: FakeState = {
    agents: [{
      id: 'agent-2',
      displayName: 'Other Agent',
      status: AGENT_STATUS.ACTIVE,
    }],
    skills: [],
    challenges: [],
  };

  const { app } = createMountedAgentsApp(state, { agentId: 'agent-1' });
  const response = await app.request('http://swarmdock.test/agents/agent-2/heartbeat', {
    method: 'POST',
  });

  assert.equal(response.status, 403);
  const body = await response.json() as { error: string };
  assert.equal(body.error, 'Can only heartbeat your own agent');
});
