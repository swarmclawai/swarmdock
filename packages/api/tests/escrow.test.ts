import assert from 'node:assert/strict';
import test from 'node:test';
import { PLATFORM_FEE_PERCENT } from '@swarmdock/shared';
import {
  computeReleaseAmounts,
  validateWalletAddress,
  createSimulatedTxHash,
  isSimulatedTx,
  SIMULATED_TX_PREFIX,
} from '../src/services/escrow.ts';

test('computeReleaseAmounts: fee + payout equals input amount', () => {
  const amount = 1_000_000n;
  const { fee, payout } = computeReleaseAmounts(amount, 7);
  assert.equal(fee + payout, amount);
});

test('computeReleaseAmounts: applies platform fee percent at production constant', () => {
  const amount = 5_000_000n;
  const { fee, payout } = computeReleaseAmounts(amount, PLATFORM_FEE_PERCENT);
  assert.equal(fee, (amount * BigInt(PLATFORM_FEE_PERCENT)) / 100n);
  assert.equal(payout, amount - fee);
});

test('computeReleaseAmounts: rounds toward zero for non-divisible amounts', () => {
  const { fee, payout } = computeReleaseAmounts(101n, 7);
  // (101 * 7) / 100 = 707 / 100 = 7 (truncated)
  assert.equal(fee, 7n);
  assert.equal(payout, 94n);
});

test('computeReleaseAmounts: handles zero amount', () => {
  const { fee, payout } = computeReleaseAmounts(0n, 7);
  assert.equal(fee, 0n);
  assert.equal(payout, 0n);
});

test('computeReleaseAmounts: handles 0% fee (full payout)', () => {
  const { fee, payout } = computeReleaseAmounts(1_000_000n, 0);
  assert.equal(fee, 0n);
  assert.equal(payout, 1_000_000n);
});

test('computeReleaseAmounts: handles 100% fee (zero payout)', () => {
  const { fee, payout } = computeReleaseAmounts(1_000_000n, 100);
  assert.equal(fee, 1_000_000n);
  assert.equal(payout, 0n);
});

test('computeReleaseAmounts: handles very large bigint amounts without precision loss', () => {
  const amount = 10n ** 30n; // far beyond JS Number precision
  const { fee, payout } = computeReleaseAmounts(amount, 7);
  assert.equal(fee + payout, amount);
  assert.equal(fee, (amount * 7n) / 100n);
});

test('computeReleaseAmounts: rejects negative amount', () => {
  assert.throws(() => computeReleaseAmounts(-1n, 7), /Negative escrow amount/);
});

test('computeReleaseAmounts: rejects fee percent outside [0,100]', () => {
  assert.throws(() => computeReleaseAmounts(100n, -1), /Invalid fee percent/);
  assert.throws(() => computeReleaseAmounts(100n, 101), /Invalid fee percent/);
});

test('validateWalletAddress: rejects empty address', () => {
  assert.throws(() => validateWalletAddress('', 'test ctx'), /Empty wallet address \(test ctx\)/);
});

test('validateWalletAddress: rejects malformed address', () => {
  assert.throws(() => validateWalletAddress('not-an-address', 'test ctx'), /Invalid wallet address/);
});

test('validateWalletAddress: returns checksummed address for valid input', () => {
  // All-lowercase form of a known checksum address
  const lower = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
  const checksummed = validateWalletAddress(lower, 'usdc contract');
  // EIP-55 checksum should mix case
  assert.notEqual(checksummed, lower);
  assert.equal(checksummed.toLowerCase(), lower);
});

test('createSimulatedTxHash: throws in production', () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => createSimulatedTxHash(), /Simulated transaction hashes are not allowed/);
  } finally {
    process.env.NODE_ENV = original;
  }
});

test('createSimulatedTxHash: produces hex hash with sim prefix in dev', () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    const hash = createSimulatedTxHash();
    assert.ok(hash.startsWith(SIMULATED_TX_PREFIX), `expected prefix ${SIMULATED_TX_PREFIX}`);
    // 32 bytes hex = 64 chars after the 0x in the prefix
    assert.equal(hash.length, SIMULATED_TX_PREFIX.length + 64);
    assert.match(hash.slice(SIMULATED_TX_PREFIX.length), /^[0-9a-f]+$/);
  } finally {
    process.env.NODE_ENV = original;
  }
});

test('createSimulatedTxHash: returns unique values across calls', () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    const a = createSimulatedTxHash();
    const b = createSimulatedTxHash();
    assert.notEqual(a, b);
  } finally {
    process.env.NODE_ENV = original;
  }
});

test('isSimulatedTx: identifies simulated hashes', () => {
  assert.equal(isSimulatedTx(`${SIMULATED_TX_PREFIX}deadbeef`), true);
  assert.equal(isSimulatedTx('0xdeadbeef'), false);
  assert.equal(isSimulatedTx(''), false);
});
