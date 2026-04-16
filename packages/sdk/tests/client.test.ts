import assert from 'node:assert/strict';
import test from 'node:test';
import nacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';
import { SwarmDockAgent, SwarmDockClient } from '../src/client.ts';
import { SwarmDockError, TimeoutError } from '../src/errors.ts';

const { encodeBase64 } = tweetnaclUtil;

function generateTestKey(): string {
  return encodeBase64(nacl.sign.keyPair().secretKey);
}

type FetchCall = { url: string; init?: RequestInit };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeAuthMockFetch(handlers: {
  /** Optional override of the verify response body's token */
  tokens?: string[];
  protectedResponses: Response[];
}): { fetchImpl: typeof globalThis.fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const tokens = handlers.tokens ?? ['token-A', 'token-B', 'token-C'];
  let tokenIndex = 0;
  const protectedQueue = [...handlers.protectedResponses];

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });

    if (url.includes('/agents/login/challenge') || url.includes('/agents/register')) {
      return jsonResponse(200, {
        challenge: 'test-challenge',
        expiresAt: '2099-01-01T00:00:00Z',
        agentId: 'agent-test',
      });
    }
    if (url.includes('/agents/login/verify') || url.includes('/agents/verify')) {
      const token = tokens[tokenIndex] ?? `token-${tokenIndex}`;
      tokenIndex++;
      return jsonResponse(200, {
        token,
        agent: { id: 'agent-test', did: 'did:web:swarmdock.ai:agents:agent-test', displayName: 'T', trustLevel: 1, status: 'active' },
      });
    }

    const response = protectedQueue.shift();
    if (!response) {
      throw new Error(`Mock has no more protected responses for ${url}`);
    }
    return response;
  };

  return { fetchImpl, calls };
}

test('SwarmDockAgent.start defaults skill pricing to per-task', async () => {
  const agent = new SwarmDockAgent({
    name: 'Agent One',
    description: 'Reviews code and keeps metadata in sync.',
    walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    skills: [
      {
        id: 'code-review',
        name: 'Code Review',
        description: 'Reviews pull requests',
        category: 'development',
        pricing: {
          basePrice: 25,
        },
      },
    ],
  });

  const client = agent.getClient() as ReturnType<SwarmDockAgent['getClient']> & {
    register: (params: unknown) => Promise<unknown>;
    getAgentId: () => string;
  };

  let registerPayload: Record<string, unknown> | null = null;
  client.register = async (params) => {
    registerPayload = params as Record<string, unknown>;
    return {
      token: 'token',
      agent: {
        id: 'agent-1',
        did: 'did:web:swarmdock.ai:agents:agent-1',
        displayName: 'Agent One',
        trustLevel: 2,
        status: 'active',
      },
    };
  };
  client.getAgentId = () => 'agent-1';
  client.events.subscribe = () => {};
  client.events.unsubscribe = () => {};

  await agent.start();
  await agent.stop();

  const skills = registerPayload?.skills as Array<Record<string, unknown>> | undefined;
  assert.ok(skills);
  assert.equal(registerPayload?.description, 'Reviews code and keeps metadata in sync.');
  assert.equal(skills?.[0]?.pricingModel, 'per-task');
});

test('SwarmDockAgent.start syncs managed profile metadata after authenticate fallback', async () => {
  const agent = new SwarmDockAgent({
    name: 'Agent Sync',
    description: 'Canonical local description.',
    syncProfileOnStart: true,
    framework: 'openclaw',
    modelProvider: 'ollama',
    modelName: 'mistral',
    walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    skills: [
      {
        id: 'code-review',
        name: 'Code Review',
        description: 'Reviews pull requests',
        category: 'development',
        tags: ['review', 'security'],
        pricing: {
          basePrice: 25,
        },
        examples: [
          'Review this PR for logic bugs',
          'Check this diff for security issues',
          'Audit this auth middleware',
          'Find performance regressions in this patch',
          'Review this API change for edge cases',
        ],
      },
    ],
  });

  const client = agent.getClient() as ReturnType<SwarmDockAgent['getClient']> & {
    register: (params: unknown) => Promise<unknown>;
    authenticate: () => Promise<void>;
    getAgentId: () => string;
  };

  let authCalls = 0;
  let profileUpdatePayload: Record<string, unknown> | null = null;
  let skillsUpdatePayload: Array<Record<string, unknown>> | null = null;

  client.register = async () => {
    throw new SwarmDockError(409, 'already registered');
  };
  client.authenticate = async () => {
    authCalls++;
  };
  client.getAgentId = () => 'agent-sync';
  client.profile.get = async () => ({
    id: 'agent-sync',
    did: 'did:web:swarmdock.ai:agents:agent-sync',
    publicKey: 'pk',
    displayName: 'Old Name',
    description: null,
    avatarUrl: null,
    ownerDid: null,
    framework: 'other',
    frameworkVersion: null,
    modelProvider: null,
    modelName: null,
    agentCard: null,
    walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    trustLevel: 2,
    dailySpendingLimit: null,
    earningTotal: '0',
    agentCardUrl: null,
    status: 'active',
    verifiedAt: null,
    lastHeartbeat: null,
    lastActiveAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    skills: [],
  });
  client.profile.update = async (fields) => {
    profileUpdatePayload = fields as Record<string, unknown>;
    return {
      id: 'agent-sync',
      did: 'did:web:swarmdock.ai:agents:agent-sync',
      publicKey: 'pk',
      displayName: 'Agent Sync',
      description: 'Canonical local description.',
      avatarUrl: null,
      ownerDid: null,
      framework: 'openclaw',
      frameworkVersion: null,
      modelProvider: 'ollama',
      modelName: 'mistral',
      agentCard: null,
      walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
      trustLevel: 2,
      dailySpendingLimit: null,
      earningTotal: '0',
      agentCardUrl: null,
      status: 'active',
      verifiedAt: null,
      lastHeartbeat: null,
      lastActiveAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  };
  client.profile.updateSkills = async (skills) => {
    skillsUpdatePayload = skills as Array<Record<string, unknown>>;
    return { skills: [] as any[], count: skills.length };
  };
  client.events.subscribe = () => {};
  client.events.unsubscribe = () => {};

  await agent.start();
  await agent.stop();

  assert.equal(authCalls, 1);
  assert.deepEqual(profileUpdatePayload, {
    displayName: 'Agent Sync',
    description: 'Canonical local description.',
    framework: 'openclaw',
    modelProvider: 'ollama',
    modelName: 'mistral',
  });
  assert.deepEqual(skillsUpdatePayload, [{
    skillId: 'code-review',
    skillName: 'Code Review',
    description: 'Reviews pull requests',
    category: 'development',
    tags: ['review', 'security'],
    inputModes: ['text'],
    outputModes: ['text'],
    pricingModel: 'per-task',
    basePrice: '25',
    examplePrompts: [
      'Review this PR for logic bugs',
      'Check this diff for security issues',
      'Audit this auth middleware',
      'Find performance regressions in this patch',
      'Review this API change for edge cases',
    ],
  }]);
});

test('SwarmDockAgent.start skips sync writes when live metadata already matches', async () => {
  const agent = new SwarmDockAgent({
    name: 'Agent Match',
    description: 'Already current.',
    syncProfileOnStart: true,
    framework: 'openclaw',
    modelProvider: 'ollama',
    modelName: 'mistral',
    walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    skills: [
      {
        id: 'code-review',
        name: 'Code Review',
        description: 'Reviews pull requests',
        category: 'development',
        tags: ['review', 'security'],
        pricing: {
          basePrice: 25,
        },
        examples: [
          'Review this PR for logic bugs',
          'Check this diff for security issues',
          'Audit this auth middleware',
          'Find performance regressions in this patch',
          'Review this API change for edge cases',
        ],
      },
    ],
  });

  const client = agent.getClient() as ReturnType<SwarmDockAgent['getClient']> & {
    register: (params: unknown) => Promise<unknown>;
    authenticate: () => Promise<void>;
    getAgentId: () => string;
  };

  let profileUpdateCalled = false;
  let skillsUpdateCalled = false;

  client.register = async () => {
    throw new SwarmDockError(409, 'already registered');
  };
  client.authenticate = async () => {};
  client.getAgentId = () => 'agent-match';
  client.profile.get = async () => ({
    id: 'agent-match',
    did: 'did:web:swarmdock.ai:agents:agent-match',
    publicKey: 'pk',
    displayName: 'Agent Match',
    description: 'Already current.',
    avatarUrl: null,
    ownerDid: null,
    framework: 'openclaw',
    frameworkVersion: null,
    modelProvider: 'ollama',
    modelName: 'mistral',
    agentCard: null,
    walletAddress: '0x1234567890abcdef1234567890abcdef12345678',
    trustLevel: 2,
    dailySpendingLimit: null,
    earningTotal: '0',
    agentCardUrl: null,
    status: 'active',
    verifiedAt: null,
    lastHeartbeat: null,
    lastActiveAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    skills: [{
      id: 'skill-1',
      agentId: 'agent-match',
      skillId: 'code-review',
      skillName: 'Code Review',
      description: 'Reviews pull requests',
      category: 'development',
      tags: ['review', 'security'],
      inputModes: ['text'],
      outputModes: ['text'],
      pricingModel: 'per-task',
      basePrice: '25',
      currency: 'USDC',
      examplePrompts: [
        'Review this PR for logic bugs',
        'Check this diff for security issues',
        'Audit this auth middleware',
        'Find performance regressions in this patch',
        'Review this API change for edge cases',
      ],
      benchmarkScores: null,
      sampleOutputs: null,
      tasksCompleted: 0,
      avgCompletionTime: null,
      avgQualityScore: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }],
  });
  client.profile.update = async () => {
    profileUpdateCalled = true;
    throw new Error('profile update should not be called');
  };
  client.profile.updateSkills = async () => {
    skillsUpdateCalled = true;
    throw new Error('skills update should not be called');
  };
  client.events.subscribe = () => {};
  client.events.unsubscribe = () => {};

  await agent.start();
  await agent.stop();

  assert.equal(profileUpdateCalled, false);
  assert.equal(skillsUpdateCalled, false);
});

// ─── Auth refresh + 401 retry ───────────────────────────────

test('SwarmDockClient retries once after 401 by re-authenticating', async () => {
  const { fetchImpl, calls } = makeAuthMockFetch({
    protectedResponses: [
      jsonResponse(401, { error: 'token expired' }),
      jsonResponse(200, { unread: 7 }),
    ],
  });

  const client = new SwarmDockClient({
    baseUrl: 'http://swarmdock.test',
    privateKey: generateTestKey(),
    fetch: fetchImpl,
  });

  const result = await client.a2a.unreadCount();
  assert.deepEqual(result, { unread: 7 });

  const protectedCalls = calls.filter(
    (c) => !c.url.includes('/login/') && !c.url.includes('/register') && !c.url.includes('/verify'),
  );
  assert.equal(protectedCalls.length, 2, 'expected exactly 2 protected calls');
  const verifyCalls = calls.filter((c) => c.url.includes('/login/verify'));
  assert.equal(verifyCalls.length, 2, 'expected re-authentication after 401');
});

test('SwarmDockClient throws SwarmDockError when retry also returns 401', async () => {
  const { fetchImpl } = makeAuthMockFetch({
    protectedResponses: [
      jsonResponse(401, { error: 'token expired' }),
      jsonResponse(401, { error: 'still expired' }),
    ],
  });

  const client = new SwarmDockClient({
    baseUrl: 'http://swarmdock.test',
    privateKey: generateTestKey(),
    fetch: fetchImpl,
  });

  await assert.rejects(
    () => client.a2a.unreadCount(),
    (err: unknown) => err instanceof SwarmDockError && err.status === 401,
  );
});

// ─── SDK timeout + retry semantics ──────────────────────────

test('SwarmDockClient throws TimeoutError when fetch is aborted by timeout', async () => {
  const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
    // Simulate AbortSignal.timeout by waiting until the signal aborts
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(Object.assign(new DOMException('Timed out', 'TimeoutError')));
        return;
      }
      signal?.addEventListener('abort', () => {
        reject(Object.assign(new DOMException('Timed out', 'TimeoutError')));
      });
    });
  };

  const client = new SwarmDockClient({
    baseUrl: 'http://swarmdock.test',
    fetch: fetchImpl,
    defaultTimeout: 50,
  });

  await assert.rejects(
    () => client.tasks.list({}),
    (err: unknown) => err instanceof TimeoutError && err.status === 408,
  );
});

test('SwarmDockClient does not retry on non-401 4xx errors', async () => {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    return jsonResponse(400, { error: 'validation failed' });
  };

  const client = new SwarmDockClient({
    baseUrl: 'http://swarmdock.test',
    fetch: fetchImpl,
  });

  await assert.rejects(
    () => client.tasks.list({}),
    (err: unknown) => err instanceof SwarmDockError && err.status === 400,
  );
  assert.equal(calls.length, 1, 'no retry on 400');
});

test('TimeoutError preserves the underlying DOMException as cause', async () => {
  const fetchImpl: typeof globalThis.fetch = async (_input, init) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener('abort', () => {
        reject(Object.assign(new DOMException('Aborted by timeout', 'TimeoutError')));
      });
    });
  };

  const client = new SwarmDockClient({
    baseUrl: 'http://swarmdock.test',
    fetch: fetchImpl,
    defaultTimeout: 30,
  });

  try {
    await client.tasks.list({});
    assert.fail('expected TimeoutError');
  } catch (err) {
    assert.ok(err instanceof TimeoutError);
    // .cause should chain back to the original DOMException
    const cause = (err as TimeoutError).cause;
    assert.ok(cause instanceof DOMException, 'cause should be the underlying DOMException');
    assert.equal((cause as DOMException).name, 'TimeoutError');
  }
});

test('SwarmDockError accepts options-form constructor with cause', () => {
  const root = new Error('upstream failure');
  const err = new SwarmDockError(500, 'wrapped', { cause: root, details: { foo: 'bar' } });
  assert.equal(err.cause, root);
  assert.deepEqual(err.details, { foo: 'bar' });
});

test('SwarmDockError preserves legacy positional details argument', () => {
  // Backwards compatibility: `new SwarmDockError(status, msg, details, suggestion)` still works.
  const err = new SwarmDockError(404, 'not found', { resourceId: 'x' }, 'try again');
  assert.deepEqual(err.details, { resourceId: 'x' });
  assert.equal(err.suggestion, 'try again');
  assert.equal(err.cause, undefined);
});

test('SwarmDockClient does not retry on 403 (no auth refresh path)', async () => {
  const { fetchImpl, calls } = makeAuthMockFetch({
    protectedResponses: [jsonResponse(403, { error: 'forbidden' })],
  });

  const client = new SwarmDockClient({
    baseUrl: 'http://swarmdock.test',
    privateKey: generateTestKey(),
    fetch: fetchImpl,
  });

  await assert.rejects(
    () => client.a2a.unreadCount(),
    (err: unknown) => err instanceof SwarmDockError && err.status === 403,
  );
  const protectedCalls = calls.filter(
    (c) => !c.url.includes('/login/') && !c.url.includes('/register') && !c.url.includes('/verify'),
  );
  assert.equal(protectedCalls.length, 1, '403 should not trigger retry');
});
