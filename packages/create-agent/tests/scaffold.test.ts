import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { scaffoldProject } from '../src/scaffold.ts';
import { listTemplates } from '../src/templates.ts';

let workDir = '';

before(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), 'create-swarmdock-agent-test-'));
});

after(async () => {
  if (workDir) await rm(workDir, { recursive: true, force: true });
});

test('listTemplates() reports the three built-in templates', () => {
  const ids = listTemplates().map((t) => t.id).sort();
  assert.deepEqual(ids, ['auto-bidder', 'basic-worker', 'requester']);
});

test('scaffoldProject(basic-worker) writes a buildable project layout', async () => {
  const target = path.join(workDir, 'basic-app');
  const result = await scaffoldProject({
    templateId: 'basic-worker',
    projectName: 'basic-app',
    targetDir: target,
    skillIds: ['coding'],
    sdkVersion: '0.5.3',
  });

  assert.equal(result.targetDir, target);
  for (const f of ['package.json', 'tsconfig.json', 'src/index.ts', '.env.example', '.gitignore', 'README.md']) {
    assert.ok(existsSync(path.join(target, f)), `missing ${f}`);
  }

  const pkg = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'basic-app');
  assert.ok(pkg.dependencies['@swarmdock/sdk'].startsWith('^'));
  assert.ok(pkg.scripts.dev.includes('tsx'));

  const idx = await readFile(path.join(target, 'src/index.ts'), 'utf8');
  assert.ok(idx.includes('SwarmDockAgent.quickStart'));
  assert.ok(idx.includes("'coding'"));
});

test('scaffoldProject(auto-bidder) wires autoBid() with skills', async () => {
  const target = path.join(workDir, 'bidder-app');
  await scaffoldProject({
    templateId: 'auto-bidder',
    projectName: 'bidder-app',
    targetDir: target,
    skillIds: ['data-analysis', 'research'],
    sdkVersion: '0.5.3',
  });
  const idx = await readFile(path.join(target, 'src/index.ts'), 'utf8');
  assert.ok(idx.includes('agent.autoBid'));
  assert.ok(idx.includes("'data-analysis'"));
  assert.ok(idx.includes("'research'"));
  assert.ok(idx.includes('maxConcurrent'));
});

test('scaffoldProject(requester) uses waitForTask with until', async () => {
  const target = path.join(workDir, 'req-app');
  await scaffoldProject({
    templateId: 'requester',
    projectName: 'req-app',
    targetDir: target,
    skillIds: ['coding'],
    sdkVersion: '0.5.3',
  });
  const idx = await readFile(path.join(target, 'src/index.ts'), 'utf8');
  assert.ok(idx.includes('client.tasks.create'));
  assert.ok(idx.includes('waitForTask'));
  assert.ok(idx.includes('acceptBid'));
});

test('scaffoldProject refuses unknown template', async () => {
  // @ts-expect-error: intentional bad id
  await assert.rejects(() => scaffoldProject({ templateId: 'bogus', projectName: 'x', targetDir: path.join(workDir, 'x'), skillIds: [], sdkVersion: '0.5.3' }), /Unknown template/);
});

test('generated projects pin the same sdk version passed in', async () => {
  const target = path.join(workDir, 'ver-app');
  await scaffoldProject({
    templateId: 'basic-worker',
    projectName: 'ver-app',
    targetDir: target,
    skillIds: ['coding'],
    sdkVersion: '9.9.9',
  });
  const pkg = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies['@swarmdock/sdk'], '^9.9.9');
});
