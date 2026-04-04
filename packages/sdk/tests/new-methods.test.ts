import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import { SwarmDockClient } from '../src/client.ts';

// ============================================
// Test infrastructure
// ============================================

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let captured: CapturedRequest;
const originalFetch = globalThis.fetch;

/**
 * Replace globalThis.fetch with a mock that captures the request
 * and returns the given response body. Must be called BEFORE
 * constructing SwarmDockClient since fetchImpl is captured at
 * construction time.
 */
function mockFetch(responseBody: unknown, status = 200): void {
  captured = { url: '', method: '', headers: {}, body: undefined };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    captured = {
      url,
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries(init?.headers ?? {})),
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => responseBody,
    } as Response;
  }) as typeof globalThis.fetch;
}

/**
 * Create a SwarmDockClient that uses the current globalThis.fetch mock,
 * pre-authenticated so tests skip the challenge-response flow.
 */
function createAuthedClient(): SwarmDockClient {
  const client = new SwarmDockClient({ baseUrl: 'http://localhost:3100' });
  client.setToken('test-token');
  (client as unknown as { agentId: string }).agentId = 'agent-123';
  return client;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ============================================
// tasks.update
// ============================================

describe('tasks.update', () => {
  it('sends PATCH /api/v1/tasks/:id with update body', async () => {
    const taskResponse = {
      id: 'task-1',
      title: 'Updated Task',
      description: 'New description',
      status: 'open',
    };
    mockFetch(taskResponse);
    const client = createAuthedClient();

    const result = await client.tasks.update('task-1', {
      title: 'Updated Task',
      description: 'New description',
    });

    assert.equal(captured.method, 'PATCH');
    assert.ok(captured.url.endsWith('/api/v1/tasks/task-1'));
    assert.deepEqual(captured.body, {
      title: 'Updated Task',
      description: 'New description',
    });
    assert.equal(captured.headers['Authorization'], 'Bearer test-token');
    assert.equal(result.id, 'task-1');
    assert.equal(result.title, 'Updated Task');
  });

  it('sends partial update with only title', async () => {
    mockFetch({ id: 'task-2', title: 'Just title', status: 'open' });
    const client = createAuthedClient();

    await client.tasks.update('task-2', { title: 'Just title' });

    assert.equal(captured.method, 'PATCH');
    assert.ok(captured.url.endsWith('/api/v1/tasks/task-2'));
    assert.deepEqual(captured.body, { title: 'Just title' });
  });
});

// ============================================
// tasks.delete
// ============================================

describe('tasks.delete', () => {
  it('sends DELETE /api/v1/tasks/:id', async () => {
    mockFetch({});
    const client = createAuthedClient();

    await client.tasks.delete('task-99');

    assert.equal(captured.method, 'DELETE');
    assert.ok(captured.url.endsWith('/api/v1/tasks/task-99'));
    assert.equal(captured.headers['Authorization'], 'Bearer test-token');
    assert.equal(captured.body, undefined);
  });
});

// ============================================
// profile.rotateKey
// ============================================

describe('profile.rotateKey', () => {
  it('sends POST /api/v1/agents/:id/rotate-key with rotation input', async () => {
    const rotateResponse = { token: 'new-token', publicKey: 'new-pk-base64' };
    mockFetch(rotateResponse);
    const client = createAuthedClient();

    const input = {
      currentSignature: 'sig-current',
      newPublicKey: 'new-pk-base64',
      newKeySignature: 'sig-new',
      rotationChallenge: 'challenge-xyz',
    };
    const result = await client.profile.rotateKey(input);

    assert.equal(captured.method, 'POST');
    assert.ok(captured.url.endsWith('/api/v1/agents/agent-123/rotate-key'));
    assert.deepEqual(captured.body, input);
    assert.equal(result.token, 'new-token');
    assert.equal(result.publicKey, 'new-pk-base64');
  });
});

// ============================================
// profile.verifyOwner
// ============================================

describe('profile.verifyOwner', () => {
  it('sends POST /api/v1/agents/:id/verify-owner with verification input', async () => {
    mockFetch({ verified: true });
    const client = createAuthedClient();

    const input = {
      ownerDid: 'did:web:example.com:owner:1',
      signature: 'owner-sig',
      challenge: 'owner-challenge',
    };
    const result = await client.profile.verifyOwner(input);

    assert.equal(captured.method, 'POST');
    assert.ok(captured.url.endsWith('/api/v1/agents/agent-123/verify-owner'));
    assert.deepEqual(captured.body, input);
    assert.equal(result.verified, true);
  });

  it('returns verified false when verification fails', async () => {
    mockFetch({ verified: false });
    const client = createAuthedClient();

    const result = await client.profile.verifyOwner({
      ownerDid: 'did:web:example.com:owner:2',
      signature: 'bad-sig',
      challenge: 'challenge',
    });

    assert.equal(result.verified, false);
  });
});

// ============================================
// a2a.getMessages
// ============================================

describe('a2a.getMessages', () => {
  it('sends GET /api/v1/a2a/messages with no query params by default', async () => {
    const messagesResponse = {
      messages: [
        { id: 'msg-1', recipientId: 'agent-123', senderId: 'agent-456', type: 'text', payload: { text: 'hello' }, readAt: null, createdAt: '2026-01-01T00:00:00Z' },
      ],
      count: 1,
      cursor: null,
    };
    mockFetch(messagesResponse);
    const client = createAuthedClient();

    const result = await client.a2a.getMessages();

    assert.equal(captured.method, 'GET');
    assert.ok(captured.url.includes('/api/v1/a2a/messages'));
    // No query string when no options provided
    assert.ok(!captured.url.includes('?') || captured.url.endsWith('/api/v1/a2a/messages'));
    assert.equal(result.count, 1);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].id, 'msg-1');
  });

  it('sends query params when options are provided', async () => {
    mockFetch({ messages: [], count: 0, cursor: null });
    const client = createAuthedClient();

    await client.a2a.getMessages({ since: '2026-01-01T00:00:00Z', limit: 10, ack: true });

    assert.ok(captured.url.includes('since='));
    assert.ok(captured.url.includes('limit=10'));
    assert.ok(captured.url.includes('ack=true'));
  });

  it('omits ack param when false', async () => {
    mockFetch({ messages: [], count: 0, cursor: null });
    const client = createAuthedClient();

    await client.a2a.getMessages({ ack: false });

    assert.ok(!captured.url.includes('ack='));
  });
});

// ============================================
// a2a.sendMessage
// ============================================

describe('a2a.sendMessage', () => {
  it('sends POST /api/v1/a2a/messages with message input', async () => {
    const messageResponse = {
      id: 'msg-new',
      recipientId: 'agent-789',
      senderId: 'agent-123',
      type: 'task-request',
      payload: { taskId: 'task-1' },
      readAt: null,
      createdAt: '2026-04-04T12:00:00Z',
    };
    mockFetch(messageResponse);
    const client = createAuthedClient();

    const input = {
      recipientId: 'agent-789',
      type: 'task-request',
      payload: { taskId: 'task-1' },
    };
    const result = await client.a2a.sendMessage(input);

    assert.equal(captured.method, 'POST');
    assert.ok(captured.url.endsWith('/api/v1/a2a/messages'));
    assert.deepEqual(captured.body, input);
    assert.equal(result.id, 'msg-new');
    assert.equal(result.recipientId, 'agent-789');
    assert.equal(result.type, 'task-request');
  });
});

// ============================================
// a2a.ackMessages
// ============================================

describe('a2a.ackMessages', () => {
  it('sends POST /api/v1/a2a/messages/ack with message IDs', async () => {
    mockFetch({ acknowledged: true });
    const client = createAuthedClient();

    const result = await client.a2a.ackMessages(['msg-1', 'msg-2', 'msg-3']);

    assert.equal(captured.method, 'POST');
    assert.ok(captured.url.endsWith('/api/v1/a2a/messages/ack'));
    assert.deepEqual(captured.body, { messageIds: ['msg-1', 'msg-2', 'msg-3'] });
    assert.equal(result.acknowledged, true);
  });

  it('works with a single message ID', async () => {
    mockFetch({ acknowledged: true });
    const client = createAuthedClient();

    const result = await client.a2a.ackMessages(['msg-solo']);

    assert.deepEqual(captured.body, { messageIds: ['msg-solo'] });
    assert.equal(result.acknowledged, true);
  });
});

// ============================================
// a2a.unreadCount
// ============================================

describe('a2a.unreadCount', () => {
  it('sends GET /api/v1/a2a/messages/count', async () => {
    mockFetch({ unread: 5 });
    const client = createAuthedClient();

    const result = await client.a2a.unreadCount();

    assert.equal(captured.method, 'GET');
    assert.ok(captured.url.endsWith('/api/v1/a2a/messages/count'));
    assert.equal(result.unread, 5);
  });

  it('returns zero when no unread messages', async () => {
    mockFetch({ unread: 0 });
    const client = createAuthedClient();

    const result = await client.a2a.unreadCount();

    assert.equal(result.unread, 0);
  });
});

// ============================================
// analytics.get
// ============================================

describe('analytics.get', () => {
  it('sends GET /api/v1/analytics/:agentId using authenticated agent ID', async () => {
    const analyticsResponse = {
      agentId: 'agent-123',
      tasksCompleted: 42,
      totalEarnings: '150000000',
      bidWinRate: 0.75,
      avgCompletionTime: 3600,
      reputationTrend: [{ dimension: 'quality', score: 4.5, confidence: 0.9, totalRatings: 20 }],
    };
    mockFetch(analyticsResponse);
    const client = createAuthedClient();

    const result = await client.analytics.get();

    assert.equal(captured.method, 'GET');
    assert.ok(captured.url.endsWith('/api/v1/analytics/agent-123'));
    assert.equal(result.agentId, 'agent-123');
    assert.equal(result.tasksCompleted, 42);
    assert.equal(result.totalEarnings, '150000000');
    assert.equal(result.bidWinRate, 0.75);
  });

  it('sends GET /api/v1/analytics/:agentId with explicit agent ID', async () => {
    mockFetch({
      agentId: 'agent-other',
      tasksCompleted: 10,
      totalEarnings: '5000000',
      bidWinRate: 0.5,
      avgCompletionTime: null,
      reputationTrend: [],
    });
    const client = createAuthedClient();

    const result = await client.analytics.get('agent-other');

    assert.ok(captured.url.endsWith('/api/v1/analytics/agent-other'));
    assert.equal(result.agentId, 'agent-other');
    assert.equal(result.tasksCompleted, 10);
  });
});

// ============================================
// Error handling (shared across methods)
// ============================================

describe('error handling', () => {
  it('throws SwarmDockError on 404 from tasks.update', async () => {
    mockFetch({ error: 'Task not found' }, 404);
    const client = createAuthedClient();

    await assert.rejects(
      () => client.tasks.update('nonexistent', { title: 'x' }),
      (err: Error) => {
        assert.equal(err.name, 'SwarmDockError');
        assert.ok(err.message.includes('Task not found'));
        return true;
      },
    );
  });

  it('throws SwarmDockError on 400 from a2a.sendMessage', async () => {
    mockFetch({ error: 'Invalid recipient' }, 400);
    const client = createAuthedClient();

    await assert.rejects(
      () => client.a2a.sendMessage({ recipientId: 'bad', type: 'text', payload: {} }),
      (err: Error) => {
        assert.equal(err.name, 'SwarmDockError');
        assert.ok(err.message.includes('Invalid recipient'));
        return true;
      },
    );
  });

  it('throws SwarmDockError on 403 from tasks.delete', async () => {
    mockFetch({ error: 'Not authorized to delete this task' }, 403);
    const client = createAuthedClient();

    await assert.rejects(
      () => client.tasks.delete('task-forbidden'),
      (err: Error) => {
        assert.equal(err.name, 'SwarmDockError');
        assert.ok(err.message.includes('Not authorized'));
        return true;
      },
    );
  });
});
