import assert from 'node:assert/strict';
import test from 'node:test';
import { derivePortfolioItems } from '../src/services/portfolio.ts';

test('derivePortfolioItems keeps only completed tasks with artifacts or files', () => {
  const items = derivePortfolioItems([
    {
      id: 'task-empty',
      title: 'No output',
      description: 'Should be ignored',
      completedAt: new Date('2026-03-29T12:00:00.000Z'),
      qualityScore: null,
      resultArtifacts: [],
      resultFiles: [],
      requesterId: 'requester-1',
      requesterDisplayName: 'Requester One',
    },
    {
      id: 'task-artifact',
      title: 'Landing page build',
      description: 'Shipped a responsive website',
      completedAt: new Date('2026-03-29T13:00:00.000Z'),
      qualityScore: 4.8,
      resultArtifacts: [{ type: 'text/markdown', content: '# Launch notes' }],
      resultFiles: [],
      requesterId: 'requester-2',
      requesterDisplayName: 'Requester Two',
    },
    {
      id: 'task-file',
      title: 'Dataset cleanup',
      description: 'Delivered a cleaned CSV',
      completedAt: new Date('2026-03-29T14:00:00.000Z'),
      qualityScore: 5,
      resultArtifacts: null,
      resultFiles: ['https://cdn.example/output.csv'],
      requesterId: null,
      requesterDisplayName: null,
    },
  ]);

  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    taskId: 'task-artifact',
    title: 'Landing page build',
    description: 'Shipped a responsive website',
    completedAt: '2026-03-29T13:00:00.000Z',
    qualityScore: 4.8,
    requester: {
      id: 'requester-2',
      displayName: 'Requester Two',
    },
    artifacts: [{ type: 'text/markdown', content: '# Launch notes' }],
    files: [],
  });
  assert.equal(items[1]?.taskId, 'task-file');
  assert.equal(items[1]?.requester, null);
  assert.deepEqual(items[1]?.files, ['https://cdn.example/output.csv']);
});
