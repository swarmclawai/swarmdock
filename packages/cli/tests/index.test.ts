import assert from 'node:assert/strict';
import test from 'node:test';
import {
  csvList,
  matchesSkillFilter,
  parseUsdcAmount,
  resolveConfigPath,
  resolveRuntimeOptions,
} from '../src/index.ts';

test('parseUsdcAmount converts decimal USDC strings into micro-units', () => {
  assert.equal(parseUsdcAmount('3'), '3000000');
  assert.equal(parseUsdcAmount('3.25'), '3250000');
  assert.equal(parseUsdcAmount('0.000001'), '1');
  assert.throws(() => parseUsdcAmount('3.1234567'), /Invalid USDC amount/);
});

test('matchesSkillFilter performs case-insensitive matching against task skills', () => {
  assert.equal(matchesSkillFilter(['Web-Design', 'copywriting'], ['web-design']), true);
  assert.equal(matchesSkillFilter(['Web-Design', 'copywriting'], ['data-analysis']), false);
  assert.equal(matchesSkillFilter(undefined, ['web-design']), false);
  assert.equal(matchesSkillFilter(['anything'], []), true);
});

test('csvList trims empty values from comma-separated filters', () => {
  assert.deepEqual(csvList('web-design, data-analysis, ,'), ['web-design', 'data-analysis']);
  assert.equal(csvList(''), undefined);
});

test('resolveConfigPath preserves absolute paths and resolves relative ones', () => {
  assert.equal(resolveConfigPath('/tmp/swarmdock.json'), '/tmp/swarmdock.json');
  assert.equal(resolveConfigPath('config/swarmdock.json').endsWith('/config/swarmdock.json'), true);
});

test('resolveRuntimeOptions applies flags over env and config', () => {
  const resolved = resolveRuntimeOptions(
    {
      apiUrl: 'https://flags.example',
      privateKey: 'flag-key',
      walletAddress: '0x3333333333333333333333333333333333333333',
      json: true,
    },
    {
      SWARMDOCK_API_URL: 'https://env.example',
      SWARMDOCK_AGENT_PRIVATE_KEY: 'env-key',
      SWARMDOCK_WALLET_ADDRESS: '0x2222222222222222222222222222222222222222',
    },
    {
      apiUrl: 'https://config.example',
      profile: {
        walletAddress: '0x1111111111111111111111111111111111111111',
      },
    },
  );

  assert.equal(resolved.apiUrl, 'https://flags.example');
  assert.equal(resolved.privateKey, 'flag-key');
  assert.equal(resolved.walletAddress, '0x3333333333333333333333333333333333333333');
  assert.equal(resolved.outputJson, true);
});

test('resolveRuntimeOptions falls back through env then config', () => {
  const resolved = resolveRuntimeOptions(
    {},
    {
      SWARMDOCK_API_URL: 'https://env.example',
      SWARMDOCK_AGENT_PRIVATE_KEY: 'env-key',
      SWARMDOCK_WALLET_ADDRESS: '0x2222222222222222222222222222222222222222',
    },
    {
      apiUrl: 'https://config.example',
      profile: {
        walletAddress: '0x1111111111111111111111111111111111111111',
      },
    },
  );

  assert.equal(resolved.apiUrl, 'https://env.example');
  assert.equal(resolved.privateKey, 'env-key');
  assert.equal(resolved.walletAddress, '0x2222222222222222222222222222222222222222');
});
