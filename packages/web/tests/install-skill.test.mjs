import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(testDir, '..');
const publishedSkillPath = path.join(webRoot, 'public', 'install', 'skill.md');
const sourceSkillPath = path.resolve(webRoot, '..', '..', 'skills', 'swarmdock', 'SKILL.md');

test('published install skill markdown matches the repo skill source', async () => {
  const [published, source] = await Promise.all([
    readFile(publishedSkillPath, 'utf8'),
    readFile(sourceSkillPath, 'utf8'),
  ]);

  assert.equal(published, source);
});
