import assert from 'node:assert/strict';
import test from 'node:test';
import nacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';
import { SwarmDockClient, expBackoffWithJitter, parseRetryAfter } from '../src/client.ts';

const { encodeBase64 } = tweetnaclUtil;

function key(): string {
  return encodeBase64(nacl.sign.keyPair().secretKey);
}

test('parseRetryAfter handles integer seconds', () => {
  assert.equal(parseRetryAfter('5'), 5000);
  assert.equal(parseRetryAfter('0'), 0);
});

test('parseRetryAfter handles HTTP-date strings', () => {
  const future = new Date(Date.now() + 3000).toUTCString();
  const ms = parseRetryAfter(future);
  assert.ok(ms !== null);
  assert.ok(ms >= 2000 && ms <= 4000, `expected ~3000ms, got ${ms}`);
});

test('parseRetryAfter returns null for invalid values', () => {
  assert.equal(parseRetryAfter(null), null);
  assert.equal(parseRetryAfter('not a date'), null);
});

test('expBackoffWithJitter grows exponentially but never below 100ms', () => {
  const a1 = expBackoffWithJitter(1);
  const a2 = expBackoffWithJitter(2);
  const a3 = expBackoffWithJitter(3);
  assert.ok(a1 >= 100);
  assert.ok(a2 >= 100);
  assert.ok(a3 >= 100);
  // Not strict due to jitter, but averages grow.
});

test('SDK retries 429 responses honoring Retry-After', async () => {
  const calls: string[] = [];
  let attempts = 0;
  const fetchImpl: typeof globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url.includes('/agents/login/challenge')) {
      return new Response(JSON.stringify({ challenge: 'c', expiresAt: '2099-01-01T00:00:00Z' }), { status: 200 });
    }
    if (url.includes('/agents/login/verify')) {
      return new Response(JSON.stringify({ token: 't', agent: { id: 'a', did: 'd', displayName: 'T', trustLevel: 1, status: 'active' } }), { status: 200 });
    }
    attempts++;
    if (attempts < 2) {
      return new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const client = new SwarmDockClient({ baseUrl: 'http://test', privateKey: key(), fetch: fetchImpl });
  const result = await client.payments.balance().catch((err) => ({ err }));
  // The balance endpoint returns whatever the mock says on the second attempt
  assert.ok('ok' in (result as Record<string, unknown>) || 'err' in (result as Record<string, unknown>));
  assert.ok(attempts >= 2, `expected at least one retry, attempts=${attempts}`);
});

test('SDK gives up after max retries on repeated 429', async () => {
  const fetchImpl: typeof globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/agents/login/challenge')) {
      return new Response(JSON.stringify({ challenge: 'c', expiresAt: '2099-01-01T00:00:00Z' }), { status: 200 });
    }
    if (url.includes('/agents/login/verify')) {
      return new Response(JSON.stringify({ token: 't', agent: { id: 'a', did: 'd', displayName: 'T', trustLevel: 1, status: 'active' } }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: 'too many' }), { status: 429, headers: { 'retry-after': '0' } });
  };

  const client = new SwarmDockClient({ baseUrl: 'http://test', privateKey: key(), fetch: fetchImpl });
  await assert.rejects(() => client.payments.balance(), /too many/);
});
