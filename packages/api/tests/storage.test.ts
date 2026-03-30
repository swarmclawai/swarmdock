import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  artifactKeyFromTrustedUrl,
  normalizeArtifactKey,
  persistTaskSubmission,
  readStoredArtifact,
} from '../src/services/storage.ts';

test('persistTaskSubmission stores inline artifacts on the local filesystem fallback', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'swarmdock-artifacts-'));
  const previousStorageDir = process.env.ARTIFACT_STORAGE_DIR;
  const previousPlatformUrl = process.env.PLATFORM_URL;

  process.env.ARTIFACT_STORAGE_DIR = tempDir;
  process.env.PLATFORM_URL = 'https://swarmdock.example';

  try {
    const persisted = await persistTaskSubmission('task-123', {
      artifacts: [
        { type: 'application/json', content: { ok: true, message: 'stored' } },
        { type: 'text/plain', content: 'plain text artifact' },
      ],
      files: [],
    });

    assert.equal(persisted.artifacts.length, 2);
    assert.deepEqual(persisted.files, []);

    const firstStorage = persisted.artifacts[0]?.storage as { key: string; url: string; contentType: string } | undefined;
    assert.ok(firstStorage);
    assert.equal(firstStorage?.contentType, 'application/json');
    assert.ok(firstStorage?.url.startsWith('https://swarmdock.example/api/v1/artifacts/tasks/task-123/artifacts/'));

    const stored = await readStoredArtifact(firstStorage!.key);
    assert.ok(stored);
    assert.equal(stored?.contentType, 'application/json');
    assert.deepEqual(JSON.parse(stored!.body.toString('utf8')), { ok: true, message: 'stored' });
  } finally {
    if (previousStorageDir === undefined) {
      delete process.env.ARTIFACT_STORAGE_DIR;
    } else {
      process.env.ARTIFACT_STORAGE_DIR = previousStorageDir;
    }

    if (previousPlatformUrl === undefined) {
      delete process.env.PLATFORM_URL;
    } else {
      process.env.PLATFORM_URL = previousPlatformUrl;
    }

    await rm(tempDir, { recursive: true, force: true });
  }
});

test('persistTaskSubmission copies trusted SwarmDock artifact URLs into task files', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'swarmdock-artifacts-'));
  const previousStorageDir = process.env.ARTIFACT_STORAGE_DIR;
  const previousPlatformUrl = process.env.PLATFORM_URL;

  process.env.ARTIFACT_STORAGE_DIR = tempDir;
  process.env.PLATFORM_URL = 'https://swarmdock.example';

  try {
    const source = await persistTaskSubmission('task-source', {
      artifacts: [
        { type: 'text/plain', content: 'source artifact contents' },
      ],
      files: [],
    });

    const sourceStorage = source.artifacts[0]?.storage as { key: string; url: string } | undefined;
    assert.ok(sourceStorage);
    assert.equal(artifactKeyFromTrustedUrl(sourceStorage!.url), sourceStorage!.key);

    const persisted = await persistTaskSubmission('task-dest', {
      artifacts: [
        { type: 'application/json', content: { copied: true } },
      ],
      files: [sourceStorage!.url],
    });

    assert.equal(persisted.files.length, 1);
    assert.equal(persisted.storedFiles.length, 1);
    assert.equal(persisted.storedFiles[0]?.originalUrl, sourceStorage!.url);

    const copied = await readStoredArtifact(persisted.storedFiles[0]!.key);
    assert.ok(copied);
    assert.equal(copied?.body.toString('utf8'), 'source artifact contents');
  } finally {
    if (previousStorageDir === undefined) {
      delete process.env.ARTIFACT_STORAGE_DIR;
    } else {
      process.env.ARTIFACT_STORAGE_DIR = previousStorageDir;
    }

    if (previousPlatformUrl === undefined) {
      delete process.env.PLATFORM_URL;
    } else {
      process.env.PLATFORM_URL = previousPlatformUrl;
    }

    await rm(tempDir, { recursive: true, force: true });
  }
});

test('persistTaskSubmission rejects untrusted submission file URLs', async () => {
  await assert.rejects(
    () => persistTaskSubmission('task-789', {
      artifacts: [
        { type: 'application/json', content: { ok: true } },
      ],
      files: ['https://example.com/not-trusted.txt'],
    }),
    /trusted SwarmDock artifact URLs/,
  );
});

test('artifact key normalization rejects traversal-shaped keys and URLs', async () => {
  assert.equal(normalizeArtifactKey('../../etc/passwd'), null);
  assert.equal(normalizeArtifactKey('tasks//task-1/artifacts/file.txt'), null);
  assert.equal(
    artifactKeyFromTrustedUrl('https://swarmdock.example/api/v1/artifacts/%2E%2E/%2E%2E/etc/passwd'),
    null,
  );
  assert.equal(await readStoredArtifact('../../etc/passwd'), null);
});
