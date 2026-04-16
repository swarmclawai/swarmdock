import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasManagedBlock,
  hasSwarmdockFrontmatter,
  removeManagedBlock,
  upsertManagedBlock,
} from '../src/rules.ts';

test('upsertManagedBlock appends a new block when none exists', () => {
  const existing = '# Project\n\nHello world.\n';
  const out = upsertManagedBlock(existing, 'managed body');
  assert.ok(out.includes('<!-- swarmdock:managed:start -->'));
  assert.ok(out.includes('<!-- swarmdock:managed:end -->'));
  assert.ok(out.includes('managed body'));
  assert.ok(out.startsWith('# Project'), 'preserves original content');
});

test('upsertManagedBlock replaces an existing block in place', () => {
  const initial = upsertManagedBlock('# Project\n', 'first body');
  const updated = upsertManagedBlock(initial, 'second body');
  assert.ok(updated.includes('second body'));
  assert.ok(!updated.includes('first body'));
  // Only one set of sentinels
  assert.equal(updated.match(/swarmdock:managed:start/g)?.length, 1);
  assert.equal(updated.match(/swarmdock:managed:end/g)?.length, 1);
});

test('upsertManagedBlock is idempotent across repeated calls with the same body', () => {
  const first = upsertManagedBlock('# Project\n', 'same body');
  const second = upsertManagedBlock(first, 'same body');
  assert.equal(first, second);
});

test('upsertManagedBlock into empty content yields a clean file', () => {
  const out = upsertManagedBlock('', 'body');
  assert.ok(out.startsWith('<!-- swarmdock:managed:start -->'));
  assert.ok(out.endsWith('<!-- swarmdock:managed:end -->\n'));
});

test('removeManagedBlock restores the surrounding content', () => {
  const before = '# Project\n\nHi\n';
  const withBlock = upsertManagedBlock(before, 'stuff');
  const after = removeManagedBlock(withBlock);
  assert.ok(after.startsWith('# Project'));
  assert.ok(!after.includes('swarmdock:managed'));
});

test('removeManagedBlock on content without a block is a no-op', () => {
  const content = '# Project\nSome text.\n';
  assert.equal(removeManagedBlock(content), content);
});

test('hasManagedBlock recognizes the sentinels', () => {
  assert.equal(hasManagedBlock('nothing here'), false);
  const content = upsertManagedBlock('', 'body');
  assert.equal(hasManagedBlock(content), true);
});

test('hasSwarmdockFrontmatter detects installer-authored files', () => {
  const authored = '---\nname: swarmdock\ndescription: ok\n---\n\nbody';
  const foreign = '---\nname: other\n---\n';
  assert.equal(hasSwarmdockFrontmatter(authored), true);
  assert.equal(hasSwarmdockFrontmatter(foreign), false);
});
