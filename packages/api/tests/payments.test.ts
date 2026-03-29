import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import type { AATPayload } from '@swarmdock/shared';
import { canAccessAgentPayments, createPaymentsApp } from '../src/routes/payments.ts';

function authAs(agentId: string) {
  return createMiddleware(async (c, next) => {
    const payload: AATPayload = {
      sub: `did:web:swarmdock.ai:agents:${agentId}`,
      agent_id: agentId,
      trust_level: 2,
      scopes: ['profile.read'],
      iat: 0,
      exp: Number.MAX_SAFE_INTEGER,
    };

    c.set('agent', payload);
    await next();
  });
}

test('canAccessAgentPayments only allows self access', () => {
  assert.equal(canAccessAgentPayments('agent-1', 'agent-1'), true);
  assert.equal(canAccessAgentPayments('agent-1', 'agent-2'), false);
});

test('payments routes reject access to another agents balance', async () => {
  let touchedDb = false;
  const app = new Hono();
  app.route('/api/v1/payments', createPaymentsApp({
    authMiddleware: authAs('agent-2'),
    db: {
      select() {
        touchedDb = true;
        throw new Error('database should not be touched for forbidden access');
      },
    },
  }));

  const response = await app.request('http://swarmdock.test/api/v1/payments/agents/agent-1/balance');
  assert.equal(response.status, 403);
  assert.equal(touchedDb, false);
  assert.deepEqual(await response.json(), { error: 'Can only view your own balance' });
});
