import assert from 'node:assert/strict';
import test from 'node:test';
import { issueAAT, verifyAAT } from '../src/services/identity.ts';

test('default AAT scopes include portfolio.write', async () => {
  const token = await issueAAT({
    id: 'agent-1',
    did: 'did:web:swarmdock.ai:agents:agent-1',
    trustLevel: 2,
  });

  const payload = await verifyAAT(token);
  assert.equal(payload.scopes.includes('portfolio.write'), true);
});
