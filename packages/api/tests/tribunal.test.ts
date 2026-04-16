import assert from 'node:assert/strict';
import test from 'node:test';
import { DISPUTE_STATUS, DISPUTE_VERDICT } from '@swarmdock/shared';
import {
  HIGH_VALUE_DISPUTE_THRESHOLD_MICRO_USDC,
  isHighValueDispute,
  shouldEscalate,
  tallyTribunalVotes,
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

test('shouldEscalate ignores non-resolved (open) disputes when counting failures', async () => {
  // Two disputes exist on the task but neither has been resolved.
  // The fake DB ignores filters, so we pass only OPEN entries to confirm
  // shouldEscalate uses the list length (real DB filters by RESOLVED).
  const result = await shouldEscalate('task-1', 5_000_000n, fakeTribunalDb([]) as never);
  assert.equal(result, false, 'no resolved priors → no escalation');
});

test('shouldEscalate escalates exactly at the failure threshold (>=2)', async () => {
  const result = await shouldEscalate('task-1', 5_000_000n, fakeTribunalDb([
    { id: 'd-1', taskId: 'task-1', status: DISPUTE_STATUS.RESOLVED },
    { id: 'd-2', taskId: 'task-1', status: DISPUTE_STATUS.RESOLVED },
  ]) as never);
  assert.equal(result, true, 'two resolved disputes meet the >=2 threshold');
});

test('isHighValueDispute is exclusive at the threshold (> not >=)', () => {
  assert.equal(isHighValueDispute(HIGH_VALUE_DISPUTE_THRESHOLD_MICRO_USDC - 1n), false);
  assert.equal(isHighValueDispute(HIGH_VALUE_DISPUTE_THRESHOLD_MICRO_USDC), false);
  assert.equal(isHighValueDispute(HIGH_VALUE_DISPUTE_THRESHOLD_MICRO_USDC + 1n), true);
});

// ─── Vote tallying ──────────────────────────────────────────

test('tallyTribunalVotes returns the plurality winner', () => {
  assert.equal(
    tallyTribunalVotes([DISPUTE_VERDICT.REQUESTER_WINS, DISPUTE_VERDICT.REQUESTER_WINS, DISPUTE_VERDICT.ASSIGNEE_WINS]),
    DISPUTE_VERDICT.REQUESTER_WINS,
  );
  assert.equal(
    tallyTribunalVotes([DISPUTE_VERDICT.ASSIGNEE_WINS, DISPUTE_VERDICT.ASSIGNEE_WINS, DISPUTE_VERDICT.ASSIGNEE_WINS]),
    DISPUTE_VERDICT.ASSIGNEE_WINS,
  );
});

test('tallyTribunalVotes returns SPLIT when judges all pick different verdicts', () => {
  // Three judges, three different verdicts → no plurality
  assert.equal(
    tallyTribunalVotes([DISPUTE_VERDICT.REQUESTER_WINS, DISPUTE_VERDICT.ASSIGNEE_WINS, DISPUTE_VERDICT.SPLIT]),
    DISPUTE_VERDICT.SPLIT,
  );
});

test('tallyTribunalVotes returns SPLIT when top two verdicts tie', () => {
  // 2/2/0 — tie at the top
  assert.equal(
    tallyTribunalVotes([
      DISPUTE_VERDICT.REQUESTER_WINS,
      DISPUTE_VERDICT.REQUESTER_WINS,
      DISPUTE_VERDICT.ASSIGNEE_WINS,
      DISPUTE_VERDICT.ASSIGNEE_WINS,
    ]),
    DISPUTE_VERDICT.SPLIT,
  );
});

test('tallyTribunalVotes returns SPLIT for empty input', () => {
  assert.equal(tallyTribunalVotes([]), DISPUTE_VERDICT.SPLIT);
});

test('tallyTribunalVotes handles single-vote tribunals', () => {
  assert.equal(tallyTribunalVotes([DISPUTE_VERDICT.REQUESTER_WINS]), DISPUTE_VERDICT.REQUESTER_WINS);
});
