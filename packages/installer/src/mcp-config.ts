import TOML from '@iarna/toml';
import YAML from 'yaml';
import type { McpServerConfig, McpConfigFormat } from './types.js';

export interface McpMergeResult {
  content: string;
  warning?: string;
}

const SERVER_NAME = 'swarmdock';

/**
 * Traverse a dot path and set a server entry. Creates intermediate objects.
 * Preserves all other keys. Mutates `root`.
 */
function setByDotPath(root: Record<string, unknown>, dotPath: string, serverName: string, value: unknown): void {
  const segments = dotPath.split('.');
  let node: Record<string, unknown> = root;
  for (const seg of segments) {
    const existing = node[seg];
    if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
      node = existing as Record<string, unknown>;
    } else {
      node = node[seg] = {};
    }
  }
  node[serverName] = value;
}

function deleteByDotPath(root: Record<string, unknown>, dotPath: string, serverName: string): boolean {
  const segments = dotPath.split('.');
  let node: Record<string, unknown> = root;
  for (const seg of segments) {
    const existing = node[seg];
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) return false;
    node = existing as Record<string, unknown>;
  }
  if (serverName in node) {
    delete node[serverName];
    return true;
  }
  return false;
}

export function mergeJsonMcpConfig(
  existing: string | null,
  dotPath: string,
  server: McpServerConfig,
): McpMergeResult {
  let parsed: Record<string, unknown>;
  let warning: string | undefined;
  if (existing && existing.trim().length > 0) {
    try {
      parsed = JSON.parse(existing) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        warning = 'existing file is not a JSON object; starting fresh';
        parsed = {};
      }
    } catch {
      warning = 'existing file is not valid JSON; starting fresh';
      parsed = {};
    }
  } else {
    parsed = {};
  }
  setByDotPath(parsed, dotPath, SERVER_NAME, server);
  return { content: JSON.stringify(parsed, null, 2) + '\n', warning };
}

export function removeJsonMcpEntry(existing: string, dotPath: string): McpMergeResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(existing) as Record<string, unknown>;
  } catch {
    return { content: existing, warning: 'could not parse existing JSON; leaving as-is' };
  }
  deleteByDotPath(parsed, dotPath, SERVER_NAME);
  return { content: JSON.stringify(parsed, null, 2) + '\n' };
}

export function mergeTomlMcpConfig(
  existing: string | null,
  dotPath: string,
  server: McpServerConfig,
): McpMergeResult {
  let parsed: Record<string, unknown>;
  let warning: string | undefined;
  if (existing && existing.trim().length > 0) {
    try {
      parsed = TOML.parse(existing) as Record<string, unknown>;
    } catch {
      warning = 'existing TOML is invalid; starting fresh';
      parsed = {};
    }
  } else {
    parsed = {};
  }
  setByDotPath(parsed, dotPath, SERVER_NAME, server);
  return { content: TOML.stringify(parsed as Parameters<typeof TOML.stringify>[0]), warning };
}

export function removeTomlMcpEntry(existing: string, dotPath: string): McpMergeResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = TOML.parse(existing) as Record<string, unknown>;
  } catch {
    return { content: existing, warning: 'could not parse existing TOML; leaving as-is' };
  }
  deleteByDotPath(parsed, dotPath, SERVER_NAME);
  return { content: TOML.stringify(parsed as Parameters<typeof TOML.stringify>[0]) };
}

export function mergeYamlMcpConfig(
  existing: string | null,
  dotPath: string,
  server: McpServerConfig,
): McpMergeResult {
  let parsed: Record<string, unknown>;
  let warning: string | undefined;
  if (existing && existing.trim().length > 0) {
    try {
      const loaded = YAML.parse(existing);
      if (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) {
        parsed = loaded as Record<string, unknown>;
      } else {
        warning = 'existing YAML is not a map; starting fresh';
        parsed = {};
      }
    } catch {
      warning = 'existing YAML is invalid; starting fresh';
      parsed = {};
    }
  } else {
    parsed = {};
  }
  setByDotPath(parsed, dotPath, SERVER_NAME, server);
  return { content: YAML.stringify(parsed, { lineWidth: 120 }), warning };
}

export function removeYamlMcpEntry(existing: string, dotPath: string): McpMergeResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = YAML.parse(existing) as Record<string, unknown>;
  } catch {
    return { content: existing, warning: 'could not parse existing YAML; leaving as-is' };
  }
  deleteByDotPath(parsed, dotPath, SERVER_NAME);
  return { content: YAML.stringify(parsed, { lineWidth: 120 }) };
}

export function mergeMcpConfig(
  format: McpConfigFormat,
  existing: string | null,
  dotPath: string,
  server: McpServerConfig,
): McpMergeResult {
  switch (format) {
    case 'json': return mergeJsonMcpConfig(existing, dotPath, server);
    case 'toml': return mergeTomlMcpConfig(existing, dotPath, server);
    case 'yaml': return mergeYamlMcpConfig(existing, dotPath, server);
    case 'none': return { content: existing ?? '' };
  }
}

export function removeMcpEntry(
  format: McpConfigFormat,
  existing: string,
  dotPath: string,
): McpMergeResult {
  switch (format) {
    case 'json': return removeJsonMcpEntry(existing, dotPath);
    case 'toml': return removeTomlMcpEntry(existing, dotPath);
    case 'yaml': return removeYamlMcpEntry(existing, dotPath);
    case 'none': return { content: existing };
  }
}
