import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldFinalizePeerReview } from '../src/services/quality-verification.ts';

test('shouldFinalizePeerReview — all reviewers voted = finalize', () => {
  assert.equal(
    shouldFinalizePeerReview({
      reviewerIds: ['a', 'b', 'c'],
      votedIds: ['a', 'b', 'c'],
      declinedIds: [],
      deadlineAt: null,
    }),
    true,
  );
});

test('shouldFinalizePeerReview — some voters still pending before deadline = wait', () => {
  assert.equal(
    shouldFinalizePeerReview({
      reviewerIds: ['a', 'b', 'c'],
      votedIds: ['a'],
      declinedIds: [],
      deadlineAt: new Date(Date.now() + 60_000),
    }),
    false,
  );
});

test('shouldFinalizePeerReview — reduced quorum after deadline = finalize', () => {
  assert.equal(
    shouldFinalizePeerReview({
      reviewerIds: ['a', 'b', 'c'],
      votedIds: ['a', 'b'],
      declinedIds: [],
      deadlineAt: new Date(Date.now() - 60_000),
      now: new Date(),
    }),
    true,
    'ceil(3/2)=2 votes after deadline is enough',
  );
});

test('shouldFinalizePeerReview — all non-voters declined = finalize even before deadline', () => {
  assert.equal(
    shouldFinalizePeerReview({
      reviewerIds: ['a', 'b', 'c'],
      votedIds: ['a', 'b'],
      declinedIds: ['c'],
      deadlineAt: new Date(Date.now() + 60_000),
    }),
    true,
  );
});

test('shouldFinalizePeerReview — reduced quorum NOT met after deadline = wait', () => {
  assert.equal(
    shouldFinalizePeerReview({
      reviewerIds: ['a', 'b', 'c'],
      votedIds: ['a'],
      declinedIds: ['b'],
      deadlineAt: new Date(Date.now() - 60_000),
    }),
    false,
    'only 1 vote, quorum requires 2',
  );
});

test('shouldFinalizePeerReview — empty reviewer list never finalizes', () => {
  assert.equal(
    shouldFinalizePeerReview({
      reviewerIds: [],
      votedIds: [],
      declinedIds: [],
      deadlineAt: null,
    }),
    false,
  );
});

test('shouldFinalizePeerReview — single reviewer, they voted = finalize', () => {
  assert.equal(
    shouldFinalizePeerReview({
      reviewerIds: ['a'],
      votedIds: ['a'],
      declinedIds: [],
      deadlineAt: null,
    }),
    true,
  );
});

test('shouldFinalizePeerReview — quorum rounds up for even-count rosters', () => {
  // 4 reviewers, quorum = ceil(4/2) = 2. 2 votes + 2 declines after
  // deadline should finalize.
  assert.equal(
    shouldFinalizePeerReview({
      reviewerIds: ['a', 'b', 'c', 'd'],
      votedIds: ['a', 'b'],
      declinedIds: ['c', 'd'],
      deadlineAt: null,
    }),
    true,
  );
  // 1 vote alone should not.
  assert.equal(
    shouldFinalizePeerReview({
      reviewerIds: ['a', 'b', 'c', 'd'],
      votedIds: ['a'],
      declinedIds: ['c', 'd'],
      deadlineAt: null,
    }),
    false,
  );
});
