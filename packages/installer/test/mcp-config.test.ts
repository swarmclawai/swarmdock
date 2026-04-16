import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mergeJsonMcpConfig,
  mergeTomlMcpConfig,
  mergeYamlMcpConfig,
  removeJsonMcpEntry,
  removeTomlMcpEntry,
  removeYamlMcpEntry,
} from '../src/mcp-config.ts';

const server = {
  type: 'streamable-http' as const,
  url: 'https://www.swarmdock.ai/mcp',
  headers: { Authorization: 'Bearer ${SWARMDOCK_AGENT_PRIVATE_KEY}' },
};

test('mergeJsonMcpConfig preserves existing mcpServers entries', () => {
  const existing = JSON.stringify({
    mcpServers: { other: { type: 'stdio', command: 'ls' } },
    projects: { '/a': { history: [] } },
  });
  const { content } = mergeJsonMcpConfig(existing, 'mcpServers', server);
  const parsed = JSON.parse(content);
  assert.deepEqual(parsed.projects, { '/a': { history: [] } });
  assert.deepEqual(parsed.mcpServers.other, { type: 'stdio', command: 'ls' });
  assert.deepEqual(parsed.mcpServers.swarmdock, server);
});

test('mergeJsonMcpConfig on null starts a fresh file', () => {
  const { content, warning } = mergeJsonMcpConfig(null, 'mcpServers', server);
  assert.equal(warning, undefined);
  const parsed = JSON.parse(content);
  assert.deepEqual(parsed, { mcpServers: { swarmdock: server } });
});

test('mergeJsonMcpConfig warns on invalid JSON but still produces valid output', () => {
  const { content, warning } = mergeJsonMcpConfig('not json', 'mcpServers', server);
  assert.ok(warning?.includes('JSON'));
  const parsed = JSON.parse(content);
  assert.deepEqual(parsed.mcpServers.swarmdock, server);
});

test('mergeJsonMcpConfig supports nested dot paths', () => {
  const { content } = mergeJsonMcpConfig(null, 'servers.mcp', server);
  const parsed = JSON.parse(content);
  assert.deepEqual(parsed.servers.mcp.swarmdock, server);
});

test('removeJsonMcpEntry leaves sibling servers intact', () => {
  const existing = JSON.stringify({
    mcpServers: { other: { command: 'ls' }, swarmdock: server },
  });
  const { content } = removeJsonMcpEntry(existing, 'mcpServers');
  const parsed = JSON.parse(content);
  assert.deepEqual(parsed.mcpServers, { other: { command: 'ls' } });
});

test('mergeTomlMcpConfig produces valid TOML with section headers', () => {
  const { content } = mergeTomlMcpConfig(null, 'mcp_servers', server);
  assert.ok(content.includes('[mcp_servers.swarmdock]'));
  assert.ok(content.includes('url = "https://www.swarmdock.ai/mcp"'));
});

test('mergeTomlMcpConfig preserves unrelated tables', () => {
  const existing = `
[profile]
name = "me"

[mcp_servers.other]
command = "ls"
`;
  const { content } = mergeTomlMcpConfig(existing, 'mcp_servers', server);
  assert.ok(content.includes('[profile]'));
  assert.ok(content.includes('name = "me"'));
  assert.ok(content.includes('[mcp_servers.other]'));
  assert.ok(content.includes('[mcp_servers.swarmdock]'));
});

test('removeTomlMcpEntry drops the target entry only', () => {
  const existing = `[profile]
name = "me"

[mcp_servers.other]
command = "ls"

[mcp_servers.swarmdock]
url = "https://www.swarmdock.ai/mcp"
`;
  const { content } = removeTomlMcpEntry(existing, 'mcp_servers');
  assert.ok(!content.includes('[mcp_servers.swarmdock]'));
  assert.ok(content.includes('[mcp_servers.other]'));
  assert.ok(content.includes('[profile]'));
});

test('mergeYamlMcpConfig preserves existing keys', () => {
  const existing = 'extensions:\n  other:\n    command: ls\n';
  const { content } = mergeYamlMcpConfig(existing, 'extensions', server);
  assert.ok(content.includes('other:'));
  assert.ok(content.includes('swarmdock:'));
  assert.ok(content.includes('https://www.swarmdock.ai/mcp'));
});

test('removeYamlMcpEntry leaves the document intact otherwise', () => {
  const existing = 'extensions:\n  other:\n    command: ls\n  swarmdock:\n    url: x\n';
  const { content } = removeYamlMcpEntry(existing, 'extensions');
  assert.ok(content.includes('other:'));
  assert.ok(!content.includes('swarmdock:'));
});
