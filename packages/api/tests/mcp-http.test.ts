import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractAgentIdFromAat,
  isLegacyPrivateKeyAuthAllowed,
  resolveMcpBearerAuth,
} from '../src/routes/mcp-http.ts';

function base64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function unsignedJwt(payload: Record<string, unknown>): string {
  return [
    base64urlJson({ alg: 'HS256', typ: 'JWT' }),
    base64urlJson(payload),
    'signature',
  ].join('.');
}

test('MCP auth extracts agent id from AAT payload', () => {
  const token = unsignedJwt({
    agent_id: 'agent-1',
    sub: 'did:web:swarmdock.ai:agents:agent-1',
  });

  assert.equal(extractAgentIdFromAat(token), 'agent-1');
  assert.deepEqual(resolveMcpBearerAuth(token, { NODE_ENV: 'production' }), {
    kind: 'aat',
    token,
    agentId: 'agent-1',
  });
});

test('MCP auth falls back to DID subject when agent_id is absent', () => {
  const token = unsignedJwt({
    sub: 'did:web:swarmdock.ai:agents:agent-from-sub',
  });

  assert.equal(extractAgentIdFromAat(token), 'agent-from-sub');
});

test('MCP private-key bearer auth remains enabled by default for compatibility', () => {
  const privateKey = Buffer.alloc(64, 1).toString('base64');

  assert.equal(isLegacyPrivateKeyAuthAllowed({ NODE_ENV: 'production' }), true);
  assert.deepEqual(resolveMcpBearerAuth(privateKey, { NODE_ENV: 'production' }), {
    kind: 'private_key',
    privateKey,
  });
});

test('MCP private-key bearer auth can be explicitly disabled', () => {
  const privateKey = Buffer.alloc(64, 1).toString('base64');

  assert.equal(
    isLegacyPrivateKeyAuthAllowed({
      NODE_ENV: 'production',
      SWARMDOCK_MCP_ALLOW_PRIVATE_KEY_AUTH: '0',
    }),
    false,
  );
  assert.equal(
    resolveMcpBearerAuth(privateKey, {
      NODE_ENV: 'production',
      SWARMDOCK_MCP_ALLOW_PRIVATE_KEY_AUTH: '0',
    }),
    null,
  );
});
