/**
 * Unit tests for the MCP registry attestation flow. Covers canonicalization
 * and Ed25519 sign/verify round-trip — the security-critical bits that have
 * to work without a database.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import nacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';
import {
  canonicalizeAttestationPayload,
  type McpUsageAttestationPayload,
} from '@swarmdock/shared';

test('canonicalizeAttestationPayload sorts keys deterministically', () => {
  const a: McpUsageAttestationPayload = {
    serverSlug: 'context7',
    outcome: 'success',
    agentDid: 'did:web:swarmdock.ai:agents:123',
    signedAt: '2026-04-17T00:00:00.000Z',
    latencyMs: 420,
  };
  const b: McpUsageAttestationPayload = {
    latencyMs: 420,
    signedAt: '2026-04-17T00:00:00.000Z',
    agentDid: 'did:web:swarmdock.ai:agents:123',
    outcome: 'success',
    serverSlug: 'context7',
  };
  assert.equal(canonicalizeAttestationPayload(a), canonicalizeAttestationPayload(b));
});

test('canonicalizeAttestationPayload omits undefined optional fields', () => {
  const payload: McpUsageAttestationPayload = {
    serverSlug: 'x',
    outcome: 'success',
    agentDid: 'did:web:swarmdock.ai:agents:1',
    signedAt: '2026-04-17T00:00:00.000Z',
  };
  const serialized = canonicalizeAttestationPayload(payload);
  assert.equal(serialized.includes('latencyMs'), false);
  assert.equal(serialized.includes('errorCode'), false);
  assert.equal(serialized.includes('toolName'), false);
  assert.equal(serialized.includes('taskId'), false);
});

test('canonicalizeAttestationPayload includes all present optional fields', () => {
  const payload: McpUsageAttestationPayload = {
    serverSlug: 'x',
    outcome: 'error',
    agentDid: 'did:web:swarmdock.ai:agents:1',
    signedAt: '2026-04-17T00:00:00.000Z',
    latencyMs: 100,
    errorCode: 'EACCES',
    toolName: 'read_file',
    taskId: '00000000-0000-0000-0000-000000000000',
  };
  const serialized = canonicalizeAttestationPayload(payload);
  assert.ok(serialized.includes('"latencyMs":100'));
  assert.ok(serialized.includes('"errorCode":"EACCES"'));
  assert.ok(serialized.includes('"toolName":"read_file"'));
  assert.ok(serialized.includes('"taskId":"00000000-0000-0000-0000-000000000000"'));
});

test('Ed25519 sign/verify round-trip on canonical payload', () => {
  const kp = nacl.sign.keyPair();
  const payload: McpUsageAttestationPayload = {
    serverSlug: 'context7',
    outcome: 'success',
    agentDid: 'did:web:swarmdock.ai:agents:abc',
    signedAt: '2026-04-17T00:00:00.000Z',
    latencyMs: 250,
  };
  const canonical = canonicalizeAttestationPayload(payload);
  const message = tweetnaclUtil.decodeUTF8(canonical);
  const signature = nacl.sign.detached(message, kp.secretKey);

  const valid = nacl.sign.detached.verify(message, signature, kp.publicKey);
  assert.equal(valid, true);
});

test('tampered payload invalidates signature', () => {
  const kp = nacl.sign.keyPair();
  const original: McpUsageAttestationPayload = {
    serverSlug: 'context7',
    outcome: 'success',
    agentDid: 'did:web:swarmdock.ai:agents:abc',
    signedAt: '2026-04-17T00:00:00.000Z',
    latencyMs: 250,
  };
  const originalCanonical = canonicalizeAttestationPayload(original);
  const signature = nacl.sign.detached(tweetnaclUtil.decodeUTF8(originalCanonical), kp.secretKey);

  // Tamper — change outcome
  const tampered: McpUsageAttestationPayload = { ...original, outcome: 'error' };
  const tamperedCanonical = canonicalizeAttestationPayload(tampered);

  const valid = nacl.sign.detached.verify(
    tweetnaclUtil.decodeUTF8(tamperedCanonical),
    signature,
    kp.publicKey,
  );
  assert.equal(valid, false, 'signature over the original payload must not verify the tampered one');
});

test('wrong public key invalidates signature', () => {
  const signer = nacl.sign.keyPair();
  const imposter = nacl.sign.keyPair();
  const payload: McpUsageAttestationPayload = {
    serverSlug: 'context7',
    outcome: 'success',
    agentDid: 'did:web:swarmdock.ai:agents:abc',
    signedAt: '2026-04-17T00:00:00.000Z',
  };
  const canonical = canonicalizeAttestationPayload(payload);
  const message = tweetnaclUtil.decodeUTF8(canonical);
  const signature = nacl.sign.detached(message, signer.secretKey);

  const valid = nacl.sign.detached.verify(message, signature, imposter.publicKey);
  assert.equal(valid, false);
});
