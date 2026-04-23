import assert from 'node:assert/strict';
import test from 'node:test';
import {
  redisAcquireLock,
  redisExpire,
  redisGet,
  redisIncr,
  redisReleaseLock,
  redisSet,
  redisTtl,
  resetRedisClientForTests,
} from '../src/lib/redis.ts';

function withUpstashEnv<T>(fn: (commands: unknown[][]) => Promise<T>): Promise<T> {
  const previousUrl = process.env.UPSTASH_REDIS_REST_URL;
  const previousToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const previousRedisUrl = process.env.REDIS_URL;
  const previousFetch = globalThis.fetch;
  const commands: unknown[][] = [];
  let lockToken: string | null = null;

  process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
  delete process.env.REDIS_URL;
  resetRedisClientForTests();

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const command = JSON.parse(String(init?.body)) as unknown[];
    commands.push(command);

    let result: unknown = 'OK';
    if (command[0] === 'GET') {
      result = command[1] === 'lock:key' ? lockToken : 'cached-value';
    } else if (command[0] === 'INCR') {
      result = 2;
    } else if (command[0] === 'EXPIRE' || command[0] === 'DEL') {
      result = 1;
    } else if (command[0] === 'TTL') {
      result = 42;
    } else if (command[0] === 'SET' && command.includes('NX')) {
      lockToken = String(command[2]);
      result = 'OK';
    }

    return new Response(JSON.stringify({ result }), { status: 200 });
  }) as typeof fetch;

  return fn(commands).finally(() => {
    if (previousUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = previousUrl;
    if (previousToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = previousToken;
    if (previousRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previousRedisUrl;
    globalThis.fetch = previousFetch;
    resetRedisClientForTests();
  });
}

test('redis helpers use Upstash REST commands when configured', async () => {
  await withUpstashEnv(async (commands) => {
    assert.equal(await redisSet('cache:key', 'value', 30), true);
    assert.equal(await redisGet('cache:key'), 'cached-value');
    assert.equal(await redisIncr('counter:key'), 2);
    assert.equal(await redisExpire('cache:key', 60), true);
    assert.equal(await redisTtl('cache:key'), 42);

    assert.deepEqual(commands, [
      ['SET', 'cache:key', 'value', 'EX', 30],
      ['GET', 'cache:key'],
      ['INCR', 'counter:key'],
      ['EXPIRE', 'cache:key', 60],
      ['TTL', 'cache:key'],
    ]);
  });
});

test('redis locks use Upstash SET NX EX and owner-checked release', async () => {
  await withUpstashEnv(async (commands) => {
    const token = await redisAcquireLock('lock:key', 15);
    assert.ok(token);

    await redisReleaseLock('lock:key', token);

    assert.equal(commands.length, 3);
    assert.deepEqual(commands[0], ['SET', 'lock:key', token, 'EX', 15, 'NX']);
    assert.deepEqual(commands[1], ['GET', 'lock:key']);
    assert.deepEqual(commands[2], ['DEL', 'lock:key']);
  });
});
