import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AATPayload } from '@swarmdock/shared';
import { createMcpMarketplaceApp } from '../src/routes/mcp-marketplace.ts';
import { mcpServices, mcpToolCalls, mcpSubscriptions, agents } from '../src/db/schema.ts';

(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON() {
  return this.toString();
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authAs(agentId: string, overrides?: Partial<AATPayload>) {
  return createMiddleware(async (c, next) => {
    const payload: AATPayload = {
      sub: `did:web:swarmdock.ai:agents:${agentId}`,
      agent_id: agentId,
      trust_level: 2,
      scopes: ['mcp.read', 'mcp.write'],
      iat: 0,
      exp: Number.MAX_SAFE_INTEGER,
      ...overrides,
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

// ---------------------------------------------------------------------------
// Fake DB
// ---------------------------------------------------------------------------

type FakeState = {
  services: Array<Record<string, unknown>>;
  toolCalls: Array<Record<string, unknown>>;
  subscriptions: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
};

function createFakeDb(state: FakeState) {
  const rowsFor = (table: unknown) => {
    if (table === mcpServices) return state.services;
    if (table === mcpToolCalls) return state.toolCalls;
    if (table === mcpSubscriptions) return state.subscriptions;
    if (table === agents) return state.agents;
    throw new Error('Unsupported table');
  };

  class SelectQuery<T extends Record<string, unknown>> implements PromiseLike<T[]> {
    private rows: T[] = [];
    private isCount = false;
    private joinedTable: unknown = null;

    constructor(fields?: unknown) {
      if (fields && typeof fields === 'object') {
        const keys = Object.keys(fields as Record<string, unknown>);
        if (keys.includes('total') || keys.includes('revenue') || keys.includes('subscriberCount')) {
          this.isCount = true;
        }
      }
    }

    from(table: unknown) {
      this.rows = rowsFor(table) as T[];
      return this;
    }

    innerJoin(table: unknown, _on?: unknown) {
      this.joinedTable = table;
      return this;
    }

    where(_predicate?: unknown) {
      return this;
    }

    groupBy(_col?: unknown) {
      return this;
    }

    orderBy(_col?: unknown) {
      return this;
    }

    limit(count: number) {
      this._limit = count;
      return this;
    }

    offset(_n: number) {
      return this;
    }

    private _limit?: number;

    private resolve(): T[] {
      if (this.isCount) {
        return [{ total: this.rows.length, revenue: '0', subscriberCount: 0 }] as T[];
      }
      const sliced = this._limit != null ? this.rows.slice(0, this._limit) : this.rows;
      // For innerJoin queries (getService), wrap rows with agent info
      if (this.joinedTable) {
        const joinedRows = rowsFor(this.joinedTable);
        return sliced.map((row) => {
          const agentRow = joinedRows.find((a) => a.id === row.agentId) ?? joinedRows[0] ?? {};
          return {
            service: row,
            agent: {
              id: agentRow.id,
              displayName: agentRow.displayName,
              did: agentRow.did,
              status: agentRow.status,
            },
          };
        }) as T[];
      }
      return sliced;
    }

    then<TResult1 = T[], TResult2 = never>(
      onfulfilled?: ((value: T[]) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
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
      if (this.executed) return this.affectedRows;
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

  class InsertBuilder<T extends Record<string, unknown>> {
    constructor(private readonly table: unknown) {}

    values(payload: Record<string, unknown>) {
      const table = this.table;
      const id = `mcp-${rowsFor(table).length + 1}`;
      const row = { id, ...payload } as T;
      rowsFor(table).push(row);
      return {
        returning: () => Promise.resolve([row]),
      };
    }
  }

  return {
    async execute() {
      return { rows: [{}] };
    },
    select(fields?: unknown) {
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
  };
}

// ---------------------------------------------------------------------------
// Mounted app factory
// ---------------------------------------------------------------------------

function createMountedApp(
  state: FakeState,
  options: {
    agentId?: string;
    broadcast?: Array<unknown>;
  } = {},
) {
  const broadcast = options.broadcast ?? [];
  const app = new Hono();
  app.onError((error) => new Response(JSON.stringify({ error: error.message }), { status: 500 }));
  app.route(
    '/mcp',
    createMcpMarketplaceApp({
      authMiddleware: authAs(options.agentId ?? 'agent-owner'),
      requireScope: () => allowScope(),
      eventBus: {
        emit() {},
        broadcast(event: unknown) {
          broadcast.push(event);
        },
      },
      db: createFakeDb(state) as never,
    }),
  );
  return { app, broadcast };
}

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

function seedAgent(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'agent-owner',
    did: 'did:web:swarmdock.ai:agents:agent-owner',
    displayName: 'Test Agent',
    status: 'active',
    mcpEndpoint: 'https://agent.example.com/mcp',
    ...overrides,
  };
}

function seedService(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'service-1',
    agentId: 'agent-owner',
    name: 'Code Analysis',
    description: 'Analyzes code for bugs',
    version: '1.0.0',
    endpoint: 'https://agent.example.com/mcp',
    tools: [{ name: 'analyze', description: 'Analyze code', inputSchema: {} }],
    resources: null,
    pricingModel: 'per_call',
    pricePerCall: 100000n,
    pricePerMinute: null,
    subscriptionPrice: null,
    currency: 'USDC',
    category: 'code',
    tags: ['analysis'],
    documentation: null,
    callsTotal: 0n,
    callsMonthly: 0n,
    revenueTotal: 0n,
    avgResponseTimeMs: null,
    uptime: null,
    status: 'active',
    visibility: 'public',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const validServiceBody = {
  name: 'Code Analysis',
  description: 'Analyzes code for bugs and quality issues',
  version: '1.0.0',
  endpoint: 'https://agent.example.com/mcp',
  tools: [{ name: 'analyze', description: 'Analyze code', inputSchema: {} }],
  pricingModel: 'per_call',
  pricePerCall: '100000',
  category: 'code',
  tags: ['analysis'],
};

// ===========================================================================
// Service Publishing
// ===========================================================================

test('POST /services publishes MCP service (201)', async () => {
  const state: FakeState = {
    services: [],
    toolCalls: [],
    subscriptions: [],
    agents: [seedAgent()],
  };

  const { app, broadcast } = createMountedApp(state);

  const response = await app.request('http://swarmdock.test/mcp/services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(validServiceBody),
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.name, 'Code Analysis');
  assert.equal(body.category, 'code');
  assert.equal(state.services.length, 1);
  assert.equal(broadcast.length, 1);
  assert.equal((broadcast[0] as Record<string, unknown>).type, 'mcp.service.published');
});

test('POST /services returns 400 for invalid body', async () => {
  const state: FakeState = {
    services: [],
    toolCalls: [],
    subscriptions: [],
    agents: [seedAgent()],
  };

  const { app } = createMountedApp(state);

  const response = await app.request('http://swarmdock.test/mcp/services', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '' }),
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.ok(body.error);
  assert.equal(state.services.length, 0);
});

test('GET /services lists active services', async () => {
  const state: FakeState = {
    services: [
      seedService(),
      seedService({ id: 'service-2', name: 'Data Processor', status: 'active', visibility: 'public' }),
    ],
    toolCalls: [],
    subscriptions: [],
    agents: [seedAgent()],
  };

  const { app } = createMountedApp(state);

  const response = await app.request('http://swarmdock.test/mcp/services');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.services));
  assert.equal(typeof body.total, 'number');
});

test('GET /services/:id returns service detail', async () => {
  const state: FakeState = {
    services: [seedService()],
    toolCalls: [],
    subscriptions: [],
    agents: [seedAgent()],
  };

  const { app } = createMountedApp(state);

  const response = await app.request('http://swarmdock.test/mcp/services/service-1');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.name, 'Code Analysis');
  assert.ok(body.agent);
  assert.equal(body.agent.id, 'agent-owner');
});

test('GET /services/:id returns 404 for nonexistent service', async () => {
  const state: FakeState = {
    services: [],
    toolCalls: [],
    subscriptions: [],
    agents: [seedAgent()],
  };

  const { app } = createMountedApp(state);

  const response = await app.request('http://swarmdock.test/mcp/services/nonexistent');
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error, 'Service not found');
});

// ===========================================================================
// Service Updates
// ===========================================================================

test('PATCH /services/:id updates service (owner only)', async () => {
  const state: FakeState = {
    services: [seedService()],
    toolCalls: [],
    subscriptions: [],
    agents: [seedAgent()],
  };

  const { app } = createMountedApp(state);

  const response = await app.request('http://swarmdock.test/mcp/services/service-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'Updated description' }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.description, 'Updated description');
});

test('PATCH /services/:id returns 403 for non-owner', async () => {
  const state: FakeState = {
    services: [seedService({ agentId: 'other-agent' })],
    toolCalls: [],
    subscriptions: [],
    agents: [seedAgent()],
  };

  const { app } = createMountedApp(state);

  const response = await app.request('http://swarmdock.test/mcp/services/service-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: 'Hijack attempt' }),
  });

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, 'Not authorized to update this service');
});

// ===========================================================================
// Tool Calls
// ===========================================================================

test('POST /services/:id/call invokes tool and returns result', async () => {
  const state: FakeState = {
    services: [seedService()],
    toolCalls: [],
    subscriptions: [],
    agents: [seedAgent()],
  };

  // Mock globalThis.fetch for the MCP endpoint call
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ jsonrpc: '2.0', id: 1, result: { issues: [] } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  try {
    const { app } = createMountedApp(state);

    const response = await app.request('http://swarmdock.test/mcp/services/service-1/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolName: 'analyze', arguments: { code: 'x = 1' } }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.ok(body.id);
    assert.deepEqual(body.result, { issues: [] });
    assert.equal(typeof body.durationMs, 'number');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('POST /services/:id/call returns 404 for inactive service', async () => {
  // The fake DB where() is a no-op, so we use an empty services array
  // to simulate the service layer's AND(id=X, status='active') finding nothing.
  const state: FakeState = {
    services: [],
    toolCalls: [],
    subscriptions: [],
    agents: [seedAgent()],
  };

  const { app } = createMountedApp(state);

  const response = await app.request('http://swarmdock.test/mcp/services/service-1/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toolName: 'analyze', arguments: {} }),
  });

  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.error, 'Service not found or inactive');
});

// ===========================================================================
// Subscriptions
// ===========================================================================

test('POST /services/:id/subscribe creates subscription', async () => {
  const state: FakeState = {
    services: [seedService({ pricingModel: 'subscription', subscriptionPrice: 5000000n })],
    toolCalls: [],
    subscriptions: [],
    agents: [seedAgent()],
  };

  const { app } = createMountedApp(state);

  const response = await app.request('http://swarmdock.test/mcp/services/service-1/subscribe', {
    method: 'POST',
  });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.mcpServiceId, 'service-1');
  assert.equal(body.status, 'active');
  assert.equal(state.subscriptions.length, 1);
});

test('POST /services/:id/subscribe returns 400 for non-subscription service', async () => {
  const state: FakeState = {
    services: [seedService({ pricingModel: 'per_call' })],
    toolCalls: [],
    subscriptions: [],
    agents: [seedAgent()],
  };

  const { app } = createMountedApp(state);

  const response = await app.request('http://swarmdock.test/mcp/services/service-1/subscribe', {
    method: 'POST',
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.error, 'Service is not subscription-based');
});

test('DELETE /services/:id/subscribe cancels subscription', async () => {
  const state: FakeState = {
    services: [seedService({ pricingModel: 'subscription' })],
    toolCalls: [],
    subscriptions: [{
      id: 'sub-1',
      mcpServiceId: 'service-1',
      subscriberId: 'agent-owner',
      status: 'active',
      startedAt: new Date(),
      renewsAt: new Date(Date.now() + 30 * 86400000),
      cancelledAt: null,
    }],
    agents: [seedAgent()],
  };

  const { app } = createMountedApp(state);

  const response = await app.request('http://swarmdock.test/mcp/services/service-1/subscribe', {
    method: 'DELETE',
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.message, 'Subscription cancelled');
});

// ===========================================================================
// Stats
// ===========================================================================

test('GET /services/:id/stats returns analytics for owner', async () => {
  const state: FakeState = {
    services: [seedService({ callsTotal: 42n, callsMonthly: 10n, avgResponseTimeMs: 250 })],
    toolCalls: [],
    subscriptions: [],
    agents: [seedAgent()],
  };

  const { app } = createMountedApp(state);

  const response = await app.request('http://swarmdock.test/mcp/services/service-1/stats');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.serviceId, 'service-1');
  assert.equal(body.callsTotal, 42);
  assert.equal(body.callsMonthly, 10);
  assert.equal(body.avgResponseTimeMs, 250);
  assert.equal(typeof body.activeSubscribers, 'number');
});

test('GET /services/:id/stats returns 403 for non-owner', async () => {
  const state: FakeState = {
    services: [seedService({ agentId: 'other-agent' })],
    toolCalls: [],
    subscriptions: [],
    agents: [seedAgent()],
  };

  const { app } = createMountedApp(state);

  const response = await app.request('http://swarmdock.test/mcp/services/service-1/stats');
  assert.equal(response.status, 403);
  const body = await response.json();
  assert.equal(body.error, 'Not authorized to view stats for this service');
});
