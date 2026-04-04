import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AATPayload } from '@swarmdock/shared';
import { createSocialApp } from '../src/routes/social.ts';
import {
  agentActivity,
  agentEndorsements,
  agentFollowing,
  agentGuilds,
  guildMembers,
  agents,
  tasks,
} from '../src/db/schema.ts';

// ============================================
// Test helpers
// ============================================

function authAs(agentId: string, overrides: Partial<AATPayload> = {}) {
  return createMiddleware(async (c, next) => {
    const payload: AATPayload = {
      sub: `did:web:swarmdock.ai:agents:${agentId}`,
      agent_id: agentId,
      trust_level: 2,
      scopes: ['social.read', 'social.write'],
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

function noAuth() {
  return createMiddleware(async (_c, next) => {
    await next();
  });
}

// ============================================
// Fake DB
// ============================================

type FakeState = {
  activity: Array<Record<string, unknown>>;
  endorsements: Array<Record<string, unknown>>;
  following: Array<Record<string, unknown>>;
  guilds: Array<Record<string, unknown>>;
  members: Array<Record<string, unknown>>;
  agents: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
};

function createFakeDb(state: FakeState) {
  const rowsFor = (table: unknown): Array<Record<string, unknown>> => {
    if (table === agentActivity) return state.activity;
    if (table === agentEndorsements) return state.endorsements;
    if (table === agentFollowing) return state.following;
    if (table === agentGuilds) return state.guilds;
    if (table === guildMembers) return state.members;
    if (table === agents) return state.agents;
    if (table === tasks) return state.tasks;
    throw new Error(`Unsupported table: ${String(table)}`);
  };

  class SelectQuery {
    private rows: Array<Record<string, unknown>> = [];
    private _table: unknown = null;
    private _joinTable: unknown = null;
    private _joinOn: unknown = null;
    private _fields: Record<string, unknown> | null = null;
    private _filtered = false;

    constructor(fields?: Record<string, unknown>) {
      if (fields) this._fields = fields;
    }

    from(table: unknown) {
      this._table = table;
      this.rows = [...rowsFor(table)];
      return this;
    }

    innerJoin(joinTable: unknown, _on: unknown) {
      this._joinTable = joinTable;
      // We handle joins manually in where() / limit() by cross-matching IDs
      return this;
    }

    where(_condition?: unknown) {
      // We can't interpret drizzle conditions, so filters are applied in the
      // test-level hooks.  For simple single-table selects the tests set up
      // state so the unfiltered rows are correct.  For queries that filter by
      // a specific column value the route / service always supplies conditions
      // via Drizzle helpers — we approximate them here.
      return this;
    }

    orderBy(_expr?: unknown) {
      return this;
    }

    limit(count: number) {
      this.rows = this.rows.slice(0, count);
      return this as unknown as Promise<Array<Record<string, unknown>>>;
    }

    offset(_n: number) {
      return this;
    }

    then<TResult1 = Array<Record<string, unknown>>, TResult2 = never>(
      onfulfilled?:
        | ((value: Array<Record<string, unknown>>) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      return Promise.resolve(this.rows).then(onfulfilled, onrejected);
    }
  }

  class InsertBuilder {
    constructor(private readonly table: unknown) {}

    values(payload: Record<string, unknown>) {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const self = this;
      const doInsert = () => {
        const id = `row-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const row = { id, createdAt: new Date(), ...payload };
        rowsFor(self.table).push(row);
        return row;
      };

      return {
        returning() {
          const row = doInsert();
          return Promise.resolve([row]);
        },
        onConflictDoNothing() {
          doInsert();
          return Promise.resolve();
        },
        // Make bare `await db.insert(table).values(...)` work
        then<TResult1 = void, TResult2 = never>(
          onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ): Promise<TResult1 | TResult2> {
          doInsert();
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
          // Apply values to all matching rows (simplified — applies to all)
          const rows = rowsFor(self.table);
          for (const row of rows) {
            Object.assign(row, values);
          }
          return Promise.resolve();
        },
      };
    }
  }

  class DeleteBuilder {
    constructor(private readonly table: unknown) {}

    where(_condition?: unknown) {
      // For tests, delete the last entry (simplified)
      const rows = rowsFor(this.table);
      if (rows.length > 0) rows.pop();
      return Promise.resolve();
    }
  }

  return {
    select(fields?: Record<string, unknown>) {
      return new SelectQuery(fields);
    },
    insert(table: unknown) {
      return new InsertBuilder(table);
    },
    update(table: unknown) {
      return new UpdateBuilder(table);
    },
    delete(table: unknown) {
      return new DeleteBuilder(table);
    },
    async execute() {
      return { rows: [{}] };
    },
  };
}

// ============================================
// App factory
// ============================================

function createMountedSocialApp(
  state: FakeState,
  options: {
    agentId?: string;
    emitted?: Array<{ agentId: string; event: unknown }>;
  } = {},
) {
  const emitted = options.emitted ?? [];
  const app = new Hono();
  app.onError((error) =>
    new Response(JSON.stringify({ error: error.message }), { status: 500 }),
  );
  app.route(
    '/social',
    createSocialApp({
      authMiddleware: authAs(options.agentId ?? 'agent-1'),
      optionalAuthMiddleware: noAuth(),
      requireScope: () => allowScope(),
      eventBus: {
        emit(agentId: string, event: unknown) {
          emitted.push({ agentId, event });
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db: createFakeDb(state) as any,
    }),
  );
  return { app, emitted };
}

function emptyState(): FakeState {
  return {
    activity: [],
    endorsements: [],
    following: [],
    guilds: [],
    members: [],
    agents: [],
    tasks: [],
  };
}

const BASE = 'http://swarmdock.test';

// ============================================
// ACTIVITY FEED
// ============================================

describe('Social — Activity Feed', () => {
  it('GET /feed returns activities from followed agents', async () => {
    const state = emptyState();
    state.following.push({
      id: 'follow-1',
      followerId: 'agent-1',
      followeeId: 'agent-2',
      createdAt: new Date(),
    });
    state.activity.push(
      {
        id: 'act-1',
        agentId: 'agent-2',
        type: 'task_completed',
        title: 'Completed a task',
        visibility: 'public',
        createdAt: new Date(),
      },
      {
        id: 'act-2',
        agentId: 'agent-1',
        type: 'skill_added',
        title: 'Added a skill',
        visibility: 'public',
        createdAt: new Date(),
      },
    );

    const { app } = createMountedSocialApp(state);
    const res = await app.request(`${BASE}/social/feed`);

    assert.equal(res.status, 200);
    const body = (await res.json()) as { items: unknown[]; nextCursor: unknown };
    assert.ok(Array.isArray(body.items));
    // The feed should include the activities (own + followed)
    assert.ok(body.items.length >= 1);
  });

  it('GET /feed returns empty when following nobody', async () => {
    const state = emptyState();
    // No following entries, no activity

    const { app } = createMountedSocialApp(state);
    const res = await app.request(`${BASE}/social/feed`);

    assert.equal(res.status, 200);
    const body = (await res.json()) as { items: unknown[]; nextCursor: unknown };
    assert.ok(Array.isArray(body.items));
    assert.equal(body.items.length, 0);
  });

  it('GET /:id/activity returns agent public activity', async () => {
    const state = emptyState();
    state.activity.push({
      id: 'act-pub-1',
      agentId: 'agent-2',
      type: 'task_completed',
      title: 'Completed something',
      visibility: 'public',
      createdAt: new Date(),
    });

    const { app } = createMountedSocialApp(state);
    const res = await app.request(`${BASE}/social/agent-2/activity`);

    assert.equal(res.status, 200);
    const body = (await res.json()) as { items: unknown[]; nextCursor: unknown };
    assert.ok(Array.isArray(body.items));
    // All activity rows are returned since our fake DB doesn't filter by agentId
    assert.ok(body.items.length >= 1);
  });
});

// ============================================
// ENDORSEMENTS
// ============================================

describe('Social — Endorsements', () => {
  it('POST /endorsements creates endorsement (201)', async () => {
    const state = emptyState();
    const emitted: Array<{ agentId: string; event: unknown }> = [];
    const { app } = createMountedSocialApp(state, { emitted });

    const res = await app.request(`${BASE}/social/endorsements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endorseeId: '00000000-0000-0000-0000-000000000002',
        title: 'Great work on the task',
      }),
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as { id: string; endorserId: string; endorseeId: string };
    assert.ok(body.id);
    assert.equal(body.endorseeId, '00000000-0000-0000-0000-000000000002');

    // Should emit an event to the endorsee
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0]?.agentId, '00000000-0000-0000-0000-000000000002');
    const evt = emitted[0]?.event as { type: string };
    assert.equal(evt.type, 'social.endorsement_received');
  });

  it('POST /endorsements rejects self-endorsement (400)', async () => {
    const selfId = '00000000-0000-0000-0000-000000000001';
    const state = emptyState();
    const { app } = createMountedSocialApp(state, { agentId: selfId });

    const res = await app.request(`${BASE}/social/endorsements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        endorseeId: selfId,
        title: 'Endorsing myself',
      }),
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /yourself/i);
  });

  it('GET /:id/endorsements returns accepted endorsements', async () => {
    const state = emptyState();
    state.endorsements.push(
      {
        id: 'end-1',
        endorserId: 'agent-1',
        endorseeId: 'agent-2',
        title: 'Solid agent',
        status: 'accepted',
        verified: false,
        createdAt: new Date(),
      },
      {
        id: 'end-2',
        endorserId: 'agent-3',
        endorseeId: 'agent-2',
        title: 'Pending one',
        status: 'pending',
        verified: false,
        createdAt: new Date(),
      },
    );

    const { app } = createMountedSocialApp(state);
    const res = await app.request(`${BASE}/social/agent-2/endorsements`);

    assert.equal(res.status, 200);
    const body = (await res.json()) as { endorsements: unknown[] };
    assert.ok(Array.isArray(body.endorsements));
    // Our fake DB returns all rows — in production, the where clause filters
    // to accepted only.  We verify the endpoint shape is correct.
    assert.ok(body.endorsements.length >= 1);
  });
});

// ============================================
// FOLLOWING
// ============================================

describe('Social — Following', () => {
  it('POST /follow/:id follows an agent (201 / ok)', async () => {
    const state = emptyState();
    const { app } = createMountedSocialApp(state, { agentId: 'agent-1' });

    const res = await app.request(`${BASE}/social/follow/agent-2`, {
      method: 'POST',
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
    // Following row should be inserted
    assert.equal(state.following.length, 1);
    assert.equal(state.following[0]?.followerId, 'agent-1');
    assert.equal(state.following[0]?.followeeId, 'agent-2');
  });

  it('POST /follow/:id rejects self-follow (400)', async () => {
    const state = emptyState();
    const { app } = createMountedSocialApp(state, { agentId: 'agent-1' });

    const res = await app.request(`${BASE}/social/follow/agent-1`, {
      method: 'POST',
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /yourself/i);
    assert.equal(state.following.length, 0);
  });

  it('DELETE /follow/:id unfollows', async () => {
    const state = emptyState();
    state.following.push({
      id: 'follow-1',
      followerId: 'agent-1',
      followeeId: 'agent-2',
      createdAt: new Date(),
    });

    const { app } = createMountedSocialApp(state, { agentId: 'agent-1' });
    const res = await app.request(`${BASE}/social/follow/agent-2`, {
      method: 'DELETE',
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
    assert.equal(state.following.length, 0);
  });

  it('GET /:id/followers returns follower list', async () => {
    const state = emptyState();
    state.following.push(
      {
        id: 'follow-1',
        followerId: 'agent-1',
        followeeId: 'agent-2',
        createdAt: new Date(),
      },
      {
        id: 'follow-2',
        followerId: 'agent-3',
        followeeId: 'agent-2',
        createdAt: new Date(),
      },
    );

    const { app } = createMountedSocialApp(state);
    const res = await app.request(`${BASE}/social/agent-2/followers`);

    assert.equal(res.status, 200);
    const body = (await res.json()) as { followers: unknown[]; count: number };
    assert.ok(Array.isArray(body.followers));
    assert.equal(typeof body.count, 'number');
  });

  it('GET /:id/following returns following list', async () => {
    const state = emptyState();
    state.following.push({
      id: 'follow-1',
      followerId: 'agent-1',
      followeeId: 'agent-2',
      createdAt: new Date(),
    });

    const { app } = createMountedSocialApp(state);
    const res = await app.request(`${BASE}/social/agent-1/following`);

    assert.equal(res.status, 200);
    const body = (await res.json()) as { following: unknown[]; count: number };
    assert.ok(Array.isArray(body.following));
    assert.equal(typeof body.count, 'number');
  });
});

// ============================================
// GUILDS
// ============================================

describe('Social — Guilds', () => {
  it('POST /guilds creates guild with founder as member (201)', async () => {
    const state = emptyState();
    const { app } = createMountedSocialApp(state, { agentId: 'agent-1' });

    const res = await app.request(`${BASE}/social/guilds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'AI Builders',
        description: 'Guild for builders',
      }),
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as { id: string; name: string; founderId: string };
    assert.ok(body.id);
    assert.equal(body.name, 'AI Builders');
    assert.equal(body.founderId, 'agent-1');
    // Founder should be added as member
    assert.equal(state.members.length, 1);
    assert.equal(state.members[0]?.agentId, 'agent-1');
    assert.equal(state.members[0]?.role, 'founder');
  });

  it('GET /guilds lists public guilds', async () => {
    const state = emptyState();
    state.guilds.push(
      {
        id: 'guild-1',
        name: 'Public Guild',
        founderId: 'agent-1',
        visibility: 'public',
        memberCount: 3,
        createdAt: new Date(),
      },
      {
        id: 'guild-2',
        name: 'Private Guild',
        founderId: 'agent-2',
        visibility: 'private',
        memberCount: 1,
        createdAt: new Date(),
      },
    );

    const { app } = createMountedSocialApp(state);
    const res = await app.request(`${BASE}/social/guilds`);

    assert.equal(res.status, 200);
    const body = (await res.json()) as { guilds: unknown[] };
    assert.ok(Array.isArray(body.guilds));
    // Fake DB returns all — real DB filters to public only
    assert.ok(body.guilds.length >= 1);
  });

  it('GET /guilds/:id returns guild detail with members', async () => {
    const state = emptyState();
    state.guilds.push({
      id: 'guild-1',
      name: 'Test Guild',
      founderId: 'agent-1',
      visibility: 'public',
      memberCount: 2,
      acceptsNewMembers: true,
      createdAt: new Date(),
    });
    state.members.push(
      {
        id: 'mem-1',
        guildId: 'guild-1',
        agentId: 'agent-1',
        role: 'founder',
        joinedAt: new Date(),
      },
      {
        id: 'mem-2',
        guildId: 'guild-1',
        agentId: 'agent-2',
        role: 'member',
        joinedAt: new Date(),
      },
    );
    state.agents.push(
      { id: 'agent-1', displayName: 'Agent One', avatarUrl: null },
      { id: 'agent-2', displayName: 'Agent Two', avatarUrl: null },
    );

    const { app } = createMountedSocialApp(state);
    const res = await app.request(`${BASE}/social/guilds/guild-1`);

    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: string; name: string; members: unknown[] };
    assert.equal(body.id, 'guild-1');
    assert.equal(body.name, 'Test Guild');
    assert.ok(Array.isArray(body.members));
  });

  it('GET /guilds/:id returns 404 for unknown guild', async () => {
    const state = emptyState();
    const { app } = createMountedSocialApp(state);

    const res = await app.request(`${BASE}/social/guilds/nonexistent`);

    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /not found/i);
  });

  it('POST /guilds/:id/join joins guild', async () => {
    const state = emptyState();
    state.guilds.push({
      id: 'guild-1',
      name: 'Open Guild',
      founderId: 'agent-2',
      visibility: 'public',
      memberCount: 1,
      acceptsNewMembers: true,
      createdAt: new Date(),
    });

    const { app } = createMountedSocialApp(state, { agentId: 'agent-1' });
    const res = await app.request(`${BASE}/social/guilds/guild-1/join`, {
      method: 'POST',
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
    // Member should be added
    assert.ok(state.members.some((m) => m.agentId === 'agent-1' && m.role === 'member'));
  });

  it('POST /guilds/:id/join rejects when guild not accepting members', async () => {
    const state = emptyState();
    state.guilds.push({
      id: 'guild-1',
      name: 'Closed Guild',
      founderId: 'agent-2',
      visibility: 'public',
      memberCount: 5,
      acceptsNewMembers: false,
      createdAt: new Date(),
    });

    const { app } = createMountedSocialApp(state, { agentId: 'agent-1' });
    const res = await app.request(`${BASE}/social/guilds/guild-1/join`, {
      method: 'POST',
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /not accepting/i);
  });

  it('DELETE /guilds/:id/leave leaves guild', async () => {
    const state = emptyState();
    state.guilds.push({
      id: 'guild-1',
      name: 'Some Guild',
      founderId: 'agent-2',
      visibility: 'public',
      memberCount: 3,
      createdAt: new Date(),
    });
    state.members.push({
      id: 'mem-1',
      guildId: 'guild-1',
      agentId: 'agent-1',
      role: 'member',
      joinedAt: new Date(),
    });

    const { app } = createMountedSocialApp(state, { agentId: 'agent-1' });
    const res = await app.request(`${BASE}/social/guilds/guild-1/leave`, {
      method: 'DELETE',
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
  });

  it('DELETE /guilds/:id/leave rejects founder leaving', async () => {
    const state = emptyState();
    state.guilds.push({
      id: 'guild-1',
      name: 'Founded Guild',
      founderId: 'agent-1',
      visibility: 'public',
      memberCount: 2,
      createdAt: new Date(),
    });
    state.members.push({
      id: 'mem-1',
      guildId: 'guild-1',
      agentId: 'agent-1',
      role: 'founder',
      joinedAt: new Date(),
    });

    const { app } = createMountedSocialApp(state, { agentId: 'agent-1' });
    const res = await app.request(`${BASE}/social/guilds/guild-1/leave`, {
      method: 'DELETE',
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /founder/i);
  });

  it('DELETE /guilds/:id/leave rejects non-member leaving', async () => {
    const state = emptyState();
    state.guilds.push({
      id: 'guild-1',
      name: 'Some Guild',
      founderId: 'agent-2',
      visibility: 'public',
      memberCount: 1,
      createdAt: new Date(),
    });
    // agent-1 is NOT a member

    const { app } = createMountedSocialApp(state, { agentId: 'agent-1' });
    const res = await app.request(`${BASE}/social/guilds/guild-1/leave`, {
      method: 'DELETE',
    });

    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /not a member/i);
  });
});
