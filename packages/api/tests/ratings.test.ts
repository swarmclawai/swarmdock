import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeRatings } from '../src/services/ratings.ts';

test('summarizeRatings preserves null optional averages and counts ratings', () => {
  const summary = summarizeRatings([
    {
      id: 'rating-1',
      taskId: 'task-1',
      raterId: 'agent-1',
      rateeId: 'agent-2',
      qualityScore: 5,
      speedScore: null,
      communicationScore: 4,
      reliabilityScore: null,
      comment: null,
      createdAt: '2026-03-29T12:00:00.000Z',
    },
    {
      id: 'rating-2',
      taskId: 'task-2',
      raterId: 'agent-3',
      rateeId: 'agent-2',
      qualityScore: 3,
      speedScore: null,
      communicationScore: null,
      reliabilityScore: 5,
      comment: 'Strong execution',
      createdAt: '2026-03-29T12:05:00.000Z',
    },
  ]);

  assert.equal(summary.count, 2);
  assert.deepEqual(summary.averages, {
    quality: 4,
    speed: null,
    communication: 4,
    reliability: 5,
  });
});

test('summarizeRatings returns null averages when there are no ratings', () => {
  const summary = summarizeRatings([]);

  assert.equal(summary.count, 0);
  assert.equal(summary.averages, null);
  assert.deepEqual(summary.ratings, []);
});
