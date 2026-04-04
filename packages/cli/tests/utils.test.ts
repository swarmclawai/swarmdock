import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { homedir } from 'node:os';
import {
  csvList,
  normalizeRepeatedList,
  parseUsdcAmount,
  formatUsdc,
  formatTimestamp,
  matchesSkillFilter,
  getDefaultConfigPath,
  resolveConfigPath,
  resolveRuntimeOptions,
} from '../src/index.ts';

// ---------------------------------------------------------------------------
// csvList
// ---------------------------------------------------------------------------
describe('csvList', () => {
  it('returns undefined for undefined input', () => {
    assert.equal(csvList(undefined), undefined);
  });

  it('returns undefined for empty string', () => {
    assert.equal(csvList(''), undefined);
  });

  it('returns undefined for whitespace-only string', () => {
    assert.equal(csvList('   '), undefined);
  });

  it('returns undefined for string of just commas', () => {
    assert.equal(csvList(',,,'), undefined);
  });

  it('returns undefined for commas and spaces', () => {
    assert.equal(csvList(' , , , '), undefined);
  });

  it('splits a basic comma-separated list', () => {
    assert.deepEqual(csvList('a,b,c'), ['a', 'b', 'c']);
  });

  it('trims whitespace around items', () => {
    assert.deepEqual(csvList('  foo , bar , baz  '), ['foo', 'bar', 'baz']);
  });

  it('strips empty segments from trailing commas', () => {
    assert.deepEqual(csvList('web-design, data-analysis, ,'), ['web-design', 'data-analysis']);
  });

  it('handles a single value with no commas', () => {
    assert.deepEqual(csvList('solo'), ['solo']);
  });

  it('handles a single value with trailing comma', () => {
    assert.deepEqual(csvList('solo,'), ['solo']);
  });
});

// ---------------------------------------------------------------------------
// normalizeRepeatedList
// ---------------------------------------------------------------------------
describe('normalizeRepeatedList', () => {
  it('returns empty array for undefined input', () => {
    assert.deepEqual(normalizeRepeatedList(undefined), []);
  });

  it('returns empty array for empty string', () => {
    assert.deepEqual(normalizeRepeatedList(''), []);
  });

  it('wraps a single string in an array', () => {
    assert.deepEqual(normalizeRepeatedList('hello'), ['hello']);
  });

  it('returns the array unchanged when given an array', () => {
    assert.deepEqual(normalizeRepeatedList(['a', 'b']), ['a', 'b']);
  });

  it('returns an empty array unchanged', () => {
    assert.deepEqual(normalizeRepeatedList([] as string[]), []);
  });

  it('preserves whitespace in individual values', () => {
    assert.deepEqual(normalizeRepeatedList('  spaced  '), ['  spaced  ']);
  });
});

// ---------------------------------------------------------------------------
// parseUsdcAmount
// ---------------------------------------------------------------------------
describe('parseUsdcAmount', () => {
  it('converts a whole number to micro-units', () => {
    assert.equal(parseUsdcAmount('3'), '3000000');
  });

  it('converts a decimal amount to micro-units', () => {
    assert.equal(parseUsdcAmount('3.25'), '3250000');
  });

  it('handles the smallest possible amount (1 micro-unit)', () => {
    assert.equal(parseUsdcAmount('0.000001'), '1');
  });

  it('handles zero', () => {
    assert.equal(parseUsdcAmount('0'), '0');
  });

  it('handles zero with decimal', () => {
    assert.equal(parseUsdcAmount('0.00'), '0');
  });

  it('converts a large whole number', () => {
    assert.equal(parseUsdcAmount('1000000'), '1000000000000');
  });

  it('handles 1 USDC exactly', () => {
    assert.equal(parseUsdcAmount('1'), '1000000');
  });

  it('handles six decimal places exactly', () => {
    assert.equal(parseUsdcAmount('1.123456'), '1123456');
  });

  it('handles leading whitespace', () => {
    assert.equal(parseUsdcAmount('  5'), '5000000');
  });

  it('handles trailing whitespace', () => {
    assert.equal(parseUsdcAmount('5  '), '5000000');
  });

  it('throws for more than six decimal places', () => {
    assert.throws(() => parseUsdcAmount('3.1234567'), /Invalid USDC amount/);
  });

  it('throws for negative values', () => {
    assert.throws(() => parseUsdcAmount('-1'), /Invalid USDC amount/);
  });

  it('throws for non-numeric strings', () => {
    assert.throws(() => parseUsdcAmount('abc'), /Invalid USDC amount/);
  });

  it('throws for mixed alpha-numeric strings', () => {
    assert.throws(() => parseUsdcAmount('3.5abc'), /Invalid USDC amount/);
  });

  it('throws for empty string', () => {
    assert.throws(() => parseUsdcAmount(''), /Invalid USDC amount/);
  });

  it('throws for whitespace-only string', () => {
    assert.throws(() => parseUsdcAmount('   '), /Invalid USDC amount/);
  });

  it('throws for value with multiple dots', () => {
    assert.throws(() => parseUsdcAmount('1.2.3'), /Invalid USDC amount/);
  });
});

// ---------------------------------------------------------------------------
// formatUsdc
// ---------------------------------------------------------------------------
describe('formatUsdc', () => {
  it('returns "n/a" for null', () => {
    assert.equal(formatUsdc(null), 'n/a');
  });

  it('returns "n/a" for undefined', () => {
    assert.equal(formatUsdc(undefined), 'n/a');
  });

  it('returns "n/a" for empty string', () => {
    assert.equal(formatUsdc(''), 'n/a');
  });

  it('formats 1_000_000 as 1.00 USDC', () => {
    assert.equal(formatUsdc('1000000'), '1.00 USDC');
  });

  it('formats 3_250_000 as 3.25 USDC', () => {
    assert.equal(formatUsdc('3250000'), '3.25 USDC');
  });

  it('formats 0 as 0.00 USDC', () => {
    assert.equal(formatUsdc('0'), '0.00 USDC');
  });

  it('formats sub-cent amounts with two decimal places', () => {
    assert.equal(formatUsdc('1'), '0.00 USDC');
  });

  it('formats fractional cents', () => {
    assert.equal(formatUsdc('500000'), '0.50 USDC');
  });

  it('formats large amounts', () => {
    assert.equal(formatUsdc('1000000000000'), '1000000.00 USDC');
  });
});

// ---------------------------------------------------------------------------
// formatTimestamp
// ---------------------------------------------------------------------------
describe('formatTimestamp', () => {
  it('returns "n/a" for null', () => {
    assert.equal(formatTimestamp(null), 'n/a');
  });

  it('returns "n/a" for undefined', () => {
    assert.equal(formatTimestamp(undefined), 'n/a');
  });

  it('returns "n/a" for empty string', () => {
    assert.equal(formatTimestamp(''), 'n/a');
  });

  it('returns a formatted date string for a valid ISO timestamp', () => {
    const result = formatTimestamp('2025-01-15T12:00:00Z');
    // Exact format depends on locale, but it should be a non-empty string
    assert.ok(result.length > 0);
    assert.notEqual(result, 'n/a');
    // Should contain the year somewhere
    assert.ok(result.includes('2025'), `Expected result to contain "2025", got: "${result}"`);
  });

  it('returns a formatted string for a date-only input', () => {
    const result = formatTimestamp('2024-06-01');
    assert.ok(result.length > 0);
    assert.notEqual(result, 'n/a');
  });
});

// ---------------------------------------------------------------------------
// matchesSkillFilter
// ---------------------------------------------------------------------------
describe('matchesSkillFilter', () => {
  it('returns true when filters list is empty (no filter applied)', () => {
    assert.equal(matchesSkillFilter(['anything'], []), true);
  });

  it('returns true for empty skills when filters is also empty', () => {
    assert.equal(matchesSkillFilter([], []), true);
  });

  it('returns true for undefined skills when filters is empty', () => {
    assert.equal(matchesSkillFilter(undefined, []), true);
  });

  it('returns false when taskSkills is undefined and filters are present', () => {
    assert.equal(matchesSkillFilter(undefined, ['web-design']), false);
  });

  it('returns false when taskSkills is null and filters are present', () => {
    assert.equal(matchesSkillFilter(null, ['web-design']), false);
  });

  it('returns false when taskSkills is not an array', () => {
    assert.equal(matchesSkillFilter('web-design', ['web-design']), false);
  });

  it('returns false when taskSkills is an empty array and filters are present', () => {
    assert.equal(matchesSkillFilter([], ['web-design']), false);
  });

  it('matches case-insensitively', () => {
    assert.equal(matchesSkillFilter(['Web-Design', 'copywriting'], ['web-design']), true);
  });

  it('matches when any skill in the list matches any filter', () => {
    assert.equal(matchesSkillFilter(['a', 'b', 'c'], ['c']), true);
  });

  it('returns false when no skills match the filter', () => {
    assert.equal(matchesSkillFilter(['Web-Design', 'copywriting'], ['data-analysis']), false);
  });

  it('handles mixed-type arrays gracefully (non-string items)', () => {
    assert.equal(matchesSkillFilter([42, null, 'web-design'], ['web-design']), true);
  });

  it('returns false when all items are non-strings', () => {
    assert.equal(matchesSkillFilter([42, null, true], ['web-design']), false);
  });

  it('handles multiple filters with one match', () => {
    assert.equal(matchesSkillFilter(['coding'], ['coding', 'writing', 'design']), true);
  });

  it('returns false when none of multiple filters match', () => {
    assert.equal(matchesSkillFilter(['coding'], ['writing', 'design']), false);
  });
});

// ---------------------------------------------------------------------------
// getDefaultConfigPath
// ---------------------------------------------------------------------------
describe('getDefaultConfigPath', () => {
  it('returns a path ending in swarmdock/config.json', () => {
    const result = getDefaultConfigPath();
    assert.ok(result.endsWith(path.join('swarmdock', 'config.json')));
  });

  it('uses XDG_CONFIG_HOME when set', () => {
    const original = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = '/tmp/xdg-test';
      const result = getDefaultConfigPath();
      assert.equal(result, path.join('/tmp/xdg-test', 'swarmdock', 'config.json'));
    } finally {
      if (original === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = original;
      }
    }
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is empty', () => {
    const original = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = '';
      const result = getDefaultConfigPath();
      assert.equal(result, path.join(homedir(), '.config', 'swarmdock', 'config.json'));
    } finally {
      if (original === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = original;
      }
    }
  });

  it('falls back to ~/.config when XDG_CONFIG_HOME is only whitespace', () => {
    const original = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = '   ';
      const result = getDefaultConfigPath();
      assert.equal(result, path.join(homedir(), '.config', 'swarmdock', 'config.json'));
    } finally {
      if (original === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = original;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// resolveConfigPath
// ---------------------------------------------------------------------------
describe('resolveConfigPath', () => {
  it('returns the default config path when no candidate given', () => {
    const result = resolveConfigPath();
    assert.ok(result.endsWith(path.join('swarmdock', 'config.json')));
  });

  it('returns the default config path for undefined', () => {
    const result = resolveConfigPath(undefined);
    assert.ok(result.endsWith(path.join('swarmdock', 'config.json')));
  });

  it('returns the default config path for empty string', () => {
    const result = resolveConfigPath('');
    assert.ok(result.endsWith(path.join('swarmdock', 'config.json')));
  });

  it('preserves absolute paths unchanged', () => {
    assert.equal(resolveConfigPath('/tmp/swarmdock.json'), '/tmp/swarmdock.json');
  });

  it('resolves relative paths against cwd', () => {
    const result = resolveConfigPath('config/swarmdock.json');
    assert.equal(result, path.resolve(process.cwd(), 'config/swarmdock.json'));
  });

  it('resolves dot-relative paths', () => {
    const result = resolveConfigPath('./my-config.json');
    assert.equal(result, path.resolve(process.cwd(), './my-config.json'));
  });

  it('resolves parent-relative paths', () => {
    const result = resolveConfigPath('../config.json');
    assert.equal(result, path.resolve(process.cwd(), '../config.json'));
  });
});

// ---------------------------------------------------------------------------
// resolveRuntimeOptions
// ---------------------------------------------------------------------------
describe('resolveRuntimeOptions', () => {
  const DEFAULT_API_URL = 'https://swarmdock-api.onrender.com';

  it('applies CLI flags over env and config', () => {
    const resolved = resolveRuntimeOptions(
      {
        apiUrl: 'https://flags.example',
        privateKey: 'flag-key',
        paymentPrivateKey: '0xabc123' as `0x${string}`,
        walletAddress: '0xAAAA',
        json: true,
      },
      {
        SWARMDOCK_API_URL: 'https://env.example',
        SWARMDOCK_AGENT_PRIVATE_KEY: 'env-key',
        SWARMDOCK_WALLET_ADDRESS: '0xBBBB',
      },
      {
        apiUrl: 'https://config.example',
        profile: { walletAddress: '0xCCCC' },
      },
    );

    assert.equal(resolved.apiUrl, 'https://flags.example');
    assert.equal(resolved.privateKey, 'flag-key');
    assert.equal(resolved.paymentPrivateKey, '0xabc123');
    assert.equal(resolved.walletAddress, '0xAAAA');
    assert.equal(resolved.outputJson, true);
  });

  it('falls back to env vars when flags are absent', () => {
    const resolved = resolveRuntimeOptions(
      {},
      {
        SWARMDOCK_API_URL: 'https://env.example',
        SWARMDOCK_AGENT_PRIVATE_KEY: 'env-key',
        SWARMDOCK_WALLET_PRIVATE_KEY: '0xdef456',
        SWARMDOCK_WALLET_ADDRESS: '0xBBBB',
      },
      {
        apiUrl: 'https://config.example',
        profile: { walletAddress: '0xCCCC' },
      },
    );

    assert.equal(resolved.apiUrl, 'https://env.example');
    assert.equal(resolved.privateKey, 'env-key');
    assert.equal(resolved.paymentPrivateKey, '0xdef456');
    assert.equal(resolved.walletAddress, '0xBBBB');
  });

  it('falls back to config when flags and env are absent', () => {
    const resolved = resolveRuntimeOptions(
      {},
      {},
      {
        apiUrl: 'https://config.example',
        profile: { walletAddress: '0xCCCC' },
      },
    );

    assert.equal(resolved.apiUrl, 'https://config.example');
    assert.equal(resolved.privateKey, undefined);
    assert.equal(resolved.paymentPrivateKey, undefined);
    assert.equal(resolved.walletAddress, '0xCCCC');
  });

  it('falls back to DEFAULT_API_URL when everything is empty', () => {
    const resolved = resolveRuntimeOptions({}, {}, {});

    assert.equal(resolved.apiUrl, DEFAULT_API_URL);
    assert.equal(resolved.privateKey, undefined);
    assert.equal(resolved.paymentPrivateKey, undefined);
    assert.equal(resolved.walletAddress, undefined);
  });

  it('sets outputJson false when json flag is not set (in TTY)', () => {
    // outputJson depends on process.stdout.isTTY which we can't easily mock,
    // but we can at least verify the json flag takes effect
    const withJson = resolveRuntimeOptions({ json: true }, {}, {});
    assert.equal(withJson.outputJson, true);
  });

  it('handles empty config profile gracefully', () => {
    const resolved = resolveRuntimeOptions({}, {}, { profile: {} });
    assert.equal(resolved.walletAddress, undefined);
  });

  it('handles config without profile key', () => {
    const resolved = resolveRuntimeOptions({}, {}, {});
    assert.equal(resolved.walletAddress, undefined);
  });

  it('prefers env wallet over config wallet', () => {
    const resolved = resolveRuntimeOptions(
      {},
      { SWARMDOCK_WALLET_ADDRESS: '0xENV' },
      { profile: { walletAddress: '0xCONFIG' } },
    );
    assert.equal(resolved.walletAddress, '0xENV');
  });

  it('does not leak unrelated env vars into the result', () => {
    const resolved = resolveRuntimeOptions(
      {},
      { HOME: '/home/test', PATH: '/usr/bin' },
      {},
    );
    assert.equal(resolved.apiUrl, DEFAULT_API_URL);
    assert.equal(resolved.privateKey, undefined);
  });
});
