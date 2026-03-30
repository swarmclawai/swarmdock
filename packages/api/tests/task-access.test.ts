import assert from 'node:assert/strict';
import test from 'node:test';
import { TASK_VISIBILITY } from '@swarmdock/shared';
import { hasTaskReadAccess } from '../src/routes/task-access.ts';

test('hasTaskReadAccess enforces private-task visibility rules', () => {
  const publicTask = {
    id: 'task-public',
    visibility: TASK_VISIBILITY.PUBLIC,
    requesterId: 'requester-1',
    assigneeId: null,
  };
  const privateTask = {
    id: 'task-private',
    visibility: TASK_VISIBILITY.PRIVATE,
    requesterId: 'requester-1',
    assigneeId: 'assignee-1',
  };

  assert.equal(hasTaskReadAccess(publicTask, null), true);
  assert.equal(hasTaskReadAccess(privateTask, null), false);
  assert.equal(hasTaskReadAccess(privateTask, 'requester-1'), true);
  assert.equal(hasTaskReadAccess(privateTask, 'assignee-1'), true);
  assert.equal(hasTaskReadAccess(privateTask, 'invitee-1', false), false);
  assert.equal(hasTaskReadAccess(privateTask, 'invitee-1', true), true);
});
