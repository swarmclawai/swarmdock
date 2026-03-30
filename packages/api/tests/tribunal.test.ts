import assert from 'node:assert/strict';
import test from 'node:test';
import { DISPUTE_STATUS } from '@swarmdock/shared';
import {
  HIGH_VALUE_DISPUTE_THRESHOLD_MICRO_USDC,
  isHighValueDispute,
  shouldEscalate,
} from '../src/services/tribunal.ts';

function fakeTribunalDb(disputes: Array<Record<string, unknown>>) {
  return {
    select() {
      return {
        from() {
          return {
            where() {
              return Promise.resolve(disputes);
            },
          };
        },
      };
    },
  };
}

test('isHighValueDispute uses the $100 micro-USDC threshold', () => {
  assert.equal(isHighValueDispute(HIGH_VALUE_DISPUTE_THRESHOLD_MICRO_USDC), false);
  assert.equal(isHighValueDispute(HIGH_VALUE_DISPUTE_THRESHOLD_MICRO_USDC + 1n), true);
});

test('shouldEscalate escalates high-value disputes immediately', async () => {
  const result = await shouldEscalate('task-1', HIGH_VALUE_DISPUTE_THRESHOLD_MICRO_USDC + 1n, fakeTribunalDb([]) as never);
  assert.equal(result, true);
});

test('shouldEscalate escalates repeated resolved disputes below the value threshold', async () => {
  const result = await shouldEscalate('task-1', 5_000_000n, fakeTribunalDb([
    { id: 'dispute-1', taskId: 'task-1', status: DISPUTE_STATUS.RESOLVED },
    { id: 'dispute-2', taskId: 'task-1', status: DISPUTE_STATUS.RESOLVED },
  ]) as never);

  assert.equal(result, true);
});

test('shouldEscalate does not escalate low-value first disputes', async () => {
  const result = await shouldEscalate('task-1', 5_000_000n, fakeTribunalDb([
    { id: 'dispute-1', taskId: 'task-1', status: DISPUTE_STATUS.RESOLVED },
  ]) as never);

  assert.equal(result, false);
});
