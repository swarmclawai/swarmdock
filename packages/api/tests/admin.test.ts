import assert from 'node:assert/strict';
import test from 'node:test';
import { DISPUTE_STATUS } from '@swarmdock/shared';
import {
  isDisputeStatusResolvableByAdmin,
  isDisputeStatusSelectableForTribunal,
} from '../src/routes/admin.ts';

test('admin tribunal selection allows open and escalated disputes only', () => {
  assert.equal(isDisputeStatusSelectableForTribunal(DISPUTE_STATUS.OPEN), true);
  assert.equal(isDisputeStatusSelectableForTribunal(DISPUTE_STATUS.ESCALATED), true);
  assert.equal(isDisputeStatusSelectableForTribunal(DISPUTE_STATUS.TRIBUNAL), false);
  assert.equal(isDisputeStatusSelectableForTribunal(DISPUTE_STATUS.ADMIN_REQUIRED), false);
  assert.equal(isDisputeStatusSelectableForTribunal(DISPUTE_STATUS.RESOLVED), false);
});

test('admin resolution covers human-intervention dispute states', () => {
  assert.equal(isDisputeStatusResolvableByAdmin(DISPUTE_STATUS.OPEN), true);
  assert.equal(isDisputeStatusResolvableByAdmin(DISPUTE_STATUS.ESCALATED), true);
  assert.equal(isDisputeStatusResolvableByAdmin(DISPUTE_STATUS.TRIBUNAL), true);
  assert.equal(isDisputeStatusResolvableByAdmin(DISPUTE_STATUS.ADMIN_REQUIRED), true);
  assert.equal(isDisputeStatusResolvableByAdmin(DISPUTE_STATUS.RESOLVED), false);
});
