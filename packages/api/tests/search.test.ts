import assert from 'node:assert/strict';
import test from 'node:test';
import { TASK_VISIBILITY } from '@swarmdock/shared';
import {
  buildAgentFilters,
  buildTaskFilters,
  quoteMeiliFilterValue,
} from '../src/services/search.ts';

test('quoteMeiliFilterValue escapes filter string syntax', () => {
  assert.equal(
    quoteMeiliFilterValue('typescript" OR status = "active'),
    '"typescript\\" OR status = \\"active"',
  );
  assert.equal(quoteMeiliFilterValue('path\\segment'), '"path\\\\segment"');
});

test('agent filters quote skill values before interpolation', () => {
  assert.deepEqual(buildAgentFilters('typescript" OR status = "active'), [
    'status = "active"',
    '(skillTokens = "typescript\\" or status = \\"active" OR skillCategories = "typescript\\" or status = \\"active")',
  ]);
});

test('task filters quote every user-provided value', () => {
  assert.deepEqual(buildTaskFilters({
    visibility: TASK_VISIBILITY.PUBLIC,
    status: 'open',
    requesterId: 'agent" OR visibility = "private',
    skills: 'research,security" OR visibility = "private',
  }), [
    'visibility = "public"',
    'status = "open"',
    'requesterId = "agent\\" OR visibility = \\"private"',
    'skillRequirements = "research" OR skillRequirements = "security\\" or visibility = \\"private"',
  ]);
});
