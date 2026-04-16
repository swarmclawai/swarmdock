/**
 * Integration-style tests for install() and uninstall().
 * They write to a tmpdir and mock the credentials layer so no network or
 * persistent HOME writes happen.
 */
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Isolate the credentials layer to a fresh XDG_CONFIG_HOME *before* the module
// loads so getConfigRoot() reads the override.
let tempHome = '';

before(async () => {
  tempHome = await mkdtemp(path.join(tmpdir(), 'swarmdock-installer-test-'));
  process.env.XDG_CONFIG_HOME = tempHome;
});

after(async () => {
  if (tempHome) await rm(tempHome, { recursive: true, force: true });
});

// Seed a fake credentials file for the "default" agent so install doesn't hit
// the network.
async function seedAgent(name = 'default') {
  const { getAgentsDir, getAgentCredentialsPath, saveAgent, registerAgentInRegistry } =
    await import('../src/credentials.ts');
  await mkdir(getAgentsDir(), { recursive: true });
  const creds = {
    agentId: 'agent-abc',
    did: 'did:web:swarmdock.ai:agents:agent-abc',
    publicKey: 'pk-base64',
    privateKey: 'sk-base64',
    aat: 'jwt-token',
    apiUrl: 'https://swarmdock-api.onrender.com',
    createdAt: '2026-01-01T00:00:00Z',
    installedHosts: [],
  };
  await saveAgent(name, creds);
  await registerAgentInRegistry(name, true);
  return getAgentCredentialsPath(name);
}

test('install(claude) writes CLAUDE.md managed block + MCP config', async () => {
  await seedAgent();
  const repoDir = await mkdtemp(path.join(tmpdir(), 'swarmdock-repo-'));
  try {
    const { install } = await import('../src/install.ts');
    const result = await install({ host: 'claude', repoDir });

    assert.equal(result.host, 'claude');
    assert.equal(result.mcpConfigured, true);
    assert.ok(result.writtenFiles.some((f) => f.endsWith('CLAUDE.md')));
    assert.ok(result.writtenFiles.some((f) => f.endsWith('.claude.json')));

    const claudeMd = await readFile(path.join(repoDir, 'CLAUDE.md'), 'utf8');
    assert.ok(claudeMd.includes('<!-- swarmdock:managed:start -->'));
    assert.ok(claudeMd.includes('agent-abc'));

    const mcp = JSON.parse(await readFile(result.writtenFiles.find((f) => f.endsWith('.claude.json'))!, 'utf8'));
    assert.equal(mcp.mcpServers.swarmdock.type, 'streamable-http');
    assert.equal(mcp.mcpServers.swarmdock.url, 'https://www.swarmdock.ai/mcp');
    assert.ok(mcp.mcpServers.swarmdock.headers.Authorization.includes('${SWARMDOCK_AGENT_PRIVATE_KEY}'));
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test('install(claude) is idempotent: re-running produces byte-identical output', async () => {
  await seedAgent();
  const repoDir = await mkdtemp(path.join(tmpdir(), 'swarmdock-repo-'));
  try {
    const { install } = await import('../src/install.ts');
    await install({ host: 'claude', repoDir });
    const afterFirst = await readFile(path.join(repoDir, 'CLAUDE.md'), 'utf8');
    await install({ host: 'claude', repoDir });
    const afterSecond = await readFile(path.join(repoDir, 'CLAUDE.md'), 'utf8');
    assert.equal(afterFirst, afterSecond);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test('install(cursor) preserves other existing MCP servers', async () => {
  await seedAgent();
  const repoDir = await mkdtemp(path.join(tmpdir(), 'swarmdock-repo-'));
  try {
    await mkdir(path.join(repoDir, '.cursor'), { recursive: true });
    await writeFile(
      path.join(repoDir, '.cursor', 'mcp.json'),
      JSON.stringify({ mcpServers: { other: { command: 'ls' } } }, null, 2),
    );
    const { install } = await import('../src/install.ts');
    await install({ host: 'cursor', repoDir });
    const mcp = JSON.parse(await readFile(path.join(repoDir, '.cursor', 'mcp.json'), 'utf8'));
    assert.deepEqual(mcp.mcpServers.other, { command: 'ls' });
    assert.ok(mcp.mcpServers.swarmdock);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test('install(aider) writes CONVENTIONS.md + .aider.conf.yml with no MCP', async () => {
  await seedAgent();
  const repoDir = await mkdtemp(path.join(tmpdir(), 'swarmdock-repo-'));
  try {
    const { install } = await import('../src/install.ts');
    const result = await install({ host: 'aider', repoDir });
    assert.equal(result.mcpConfigured, false);
    assert.ok(existsSync(path.join(repoDir, 'CONVENTIONS.md')));
    assert.ok(existsSync(path.join(repoDir, '.aider.conf.yml')));
    const aiderConf = await readFile(path.join(repoDir, '.aider.conf.yml'), 'utf8');
    assert.ok(aiderConf.includes('read: CONVENTIONS.md'));
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test('install(codex) writes TOML MCP config', async () => {
  await seedAgent();
  const repoDir = await mkdtemp(path.join(tmpdir(), 'swarmdock-repo-'));
  try {
    const { install } = await import('../src/install.ts');
    const result = await install({ host: 'codex', repoDir });
    const tomlFile = result.writtenFiles.find((f) => f.endsWith('config.toml'));
    assert.ok(tomlFile);
    const toml = await readFile(tomlFile!, 'utf8');
    assert.ok(toml.includes('[mcp_servers.swarmdock]'));
    assert.ok(toml.includes('swarmdock-mcp'), 'stdio transport uses the local bin');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test('install refuses to overwrite a non-managed standalone rule file without --force', async () => {
  await seedAgent();
  const repoDir = await mkdtemp(path.join(tmpdir(), 'swarmdock-repo-'));
  try {
    const existing = '---\nname: user-authored\n---\n\nDon\'t touch me.';
    await mkdir(path.join(repoDir, '.cursor', 'rules'), { recursive: true });
    await writeFile(path.join(repoDir, '.cursor', 'rules', 'swarmdock.mdc'), existing);
    const { install } = await import('../src/install.ts');
    await assert.rejects(() => install({ host: 'cursor', repoDir }), /not authored/);
    const after = await readFile(path.join(repoDir, '.cursor', 'rules', 'swarmdock.mdc'), 'utf8');
    assert.equal(after, existing, 'existing file untouched');
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test('uninstall removes the managed block and MCP entry', async () => {
  await seedAgent();
  const repoDir = await mkdtemp(path.join(tmpdir(), 'swarmdock-repo-'));
  try {
    const { install, uninstall } = await import('../src/install.ts');
    await install({ host: 'claude', repoDir });
    const result = await uninstall({ host: 'claude', repoDir });
    const mcpFile = result.mutatedFiles.find((f) => f.endsWith('.claude.json'));
    assert.ok(mcpFile);
    const mcp = JSON.parse(await readFile(mcpFile!, 'utf8'));
    assert.equal(mcp.mcpServers?.swarmdock, undefined);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});
