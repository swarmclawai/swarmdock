import path from 'node:path';
import { homedir } from 'node:os';
import type { HostDescriptor } from './types.js';
import {
  buildAntigravityWorkflow,
  buildKiroSteering,
} from './rules.js';

const home = () => homedir();

export const HOST_REGISTRY: Record<string, HostDescriptor> = {
  claude: {
    host: 'claude',
    displayName: 'Claude Code',
    ruleKind: 'managed-markdown',
    ruleFile: (r) => path.join(r, 'CLAUDE.md'),
    ruleInRepo: true,
    mcpConfigFile: () => path.join(home(), '.claude.json'),
    mcpTransport: 'streamable-http',
    mcpFormat: 'json',
    mcpServersPath: 'mcpServers',
    mcpInRepo: false,
    supportsHook: true,
    hookPath: (r) => path.join(r, '.claude', 'hooks', 'swarmdock.js'),
    hookSettingsFile: (r) => path.join(r, '.claude', 'settings.json'),
  },

  cursor: {
    host: 'cursor',
    displayName: 'Cursor',
    ruleKind: 'cursor-rule',
    ruleFile: (r) => path.join(r, '.cursor', 'rules', 'swarmdock.mdc'),
    ruleInRepo: true,
    mcpConfigFile: (r) => path.join(r, '.cursor', 'mcp.json'),
    mcpTransport: 'streamable-http',
    mcpFormat: 'json',
    mcpServersPath: 'mcpServers',
    mcpInRepo: true,
  },

  vscode: {
    host: 'vscode',
    displayName: 'VS Code (Copilot Chat)',
    ruleKind: 'vscode-chatmode',
    ruleFile: (r) => path.join(r, '.github', 'chatmodes', 'swarmdock.chatmode.md'),
    ruleInRepo: true,
    mcpConfigFile: (r) => path.join(r, '.vscode', 'mcp.json'),
    mcpTransport: 'streamable-http',
    mcpFormat: 'json',
    mcpServersPath: 'servers',
    mcpInRepo: true,
  },

  copilot: {
    host: 'copilot',
    displayName: 'GitHub Copilot',
    ruleKind: 'managed-markdown',
    ruleFile: (r) => path.join(r, '.github', 'copilot-instructions.md'),
    ruleInRepo: true,
    mcpConfigFile: (r) => path.join(r, '.github', 'copilot-mcp.json'),
    mcpTransport: 'streamable-http',
    mcpFormat: 'json',
    mcpServersPath: 'mcpServers',
    mcpInRepo: true,
    extraFiles: [
      {
        path: (r) => path.join(r, 'AGENTS.md'),
        render: () => '',
        createOnly: true,
      },
    ],
  },

  codex: {
    host: 'codex',
    displayName: 'OpenAI Codex CLI',
    ruleKind: 'managed-markdown',
    ruleFile: (r) => path.join(r, 'AGENTS.md'),
    ruleInRepo: true,
    mcpConfigFile: () => path.join(home(), '.codex', 'config.toml'),
    mcpTransport: 'stdio',
    mcpFormat: 'toml',
    mcpServersPath: 'mcp_servers',
    mcpInRepo: false,
  },

  gemini: {
    host: 'gemini',
    displayName: 'Gemini CLI',
    ruleKind: 'managed-markdown',
    ruleFile: (r) => path.join(r, 'GEMINI.md'),
    ruleInRepo: true,
    mcpConfigFile: (r) => path.join(r, '.gemini', 'settings.json'),
    mcpTransport: 'streamable-http',
    mcpFormat: 'json',
    mcpServersPath: 'mcpServers',
    mcpInRepo: true,
    supportsHook: true,
    hookPath: (r) => path.join(r, '.gemini', 'hooks', 'swarmdock.js'),
    hookSettingsFile: (r) => path.join(r, '.gemini', 'settings.json'),
  },

  opencode: {
    host: 'opencode',
    displayName: 'OpenCode',
    ruleKind: 'managed-markdown',
    ruleFile: (r) => path.join(r, 'AGENTS.md'),
    ruleInRepo: true,
    mcpConfigFile: (r) => path.join(r, 'opencode.json'),
    mcpTransport: 'streamable-http',
    mcpFormat: 'json',
    mcpServersPath: 'mcp',
    mcpInRepo: true,
    supportsHook: true,
    hookPath: (r) => path.join(r, '.opencode', 'plugins', 'swarmdock.js'),
    hookSettingsFile: (r) => path.join(r, 'opencode.json'),
  },

  aider: {
    host: 'aider',
    displayName: 'Aider',
    ruleKind: 'aider-conventions',
    ruleFile: (r) => path.join(r, 'CONVENTIONS.md'),
    ruleInRepo: true,
    mcpFormat: 'none',
    extraFiles: [
      {
        path: (r) => path.join(r, '.aider.conf.yml'),
        render: () => '# managed by swarmdock installer\nread: CONVENTIONS.md\n',
      },
    ],
  },

  trae: {
    host: 'trae',
    displayName: 'Trae',
    ruleKind: 'standalone-md',
    ruleFile: (r) => path.join(r, '.trae', 'rules', 'swarmdock.md'),
    ruleInRepo: true,
    mcpFormat: 'none',
  },

  claw: {
    host: 'claw',
    displayName: 'OpenClaw / ClawHub',
    ruleKind: 'skill-file',
    ruleFile: (r) => path.join(r, '.claw', 'skills', 'swarmdock', 'SKILL.md'),
    ruleInRepo: true,
    mcpFormat: 'none',
  },

  droid: {
    host: 'droid',
    displayName: 'Factory Droid',
    ruleKind: 'standalone-md',
    ruleFile: (r) => path.join(r, '.factory', 'rules', 'swarmdock.md'),
    ruleInRepo: true,
    mcpFormat: 'none',
  },

  kiro: {
    host: 'kiro',
    displayName: 'Kiro',
    ruleKind: 'skill-steering',
    ruleFile: (r) => path.join(r, '.kiro', 'skills', 'swarmdock', 'SKILL.md'),
    ruleInRepo: true,
    mcpConfigFile: (r) => path.join(r, '.kiro', 'settings', 'mcp.json'),
    mcpTransport: 'streamable-http',
    mcpFormat: 'json',
    mcpServersPath: 'mcpServers',
    mcpInRepo: true,
    extraFiles: [
      {
        path: (r) => path.join(r, '.kiro', 'steering', 'swarmdock.md'),
        render: (ctx) => buildKiroSteering(ctx),
      },
    ],
  },

  hermes: {
    host: 'hermes',
    displayName: 'Hermes',
    ruleKind: 'skill-file',
    ruleFile: () => path.join(home(), '.hermes', 'skills', 'swarmdock', 'SKILL.md'),
    ruleInRepo: false,
    mcpFormat: 'none',
    extraFiles: [
      {
        path: (r) => path.join(r, 'AGENTS.md'),
        render: () => '',
        createOnly: true,
      },
    ],
  },

  antigravity: {
    host: 'antigravity',
    displayName: 'Antigravity',
    ruleKind: 'antigravity',
    ruleFile: (r) => path.join(r, '.agent', 'rules', 'swarmdock.md'),
    ruleInRepo: true,
    mcpConfigFile: (r) => path.join(r, '.agent', 'mcp.json'),
    mcpTransport: 'streamable-http',
    mcpFormat: 'json',
    mcpServersPath: 'mcpServers',
    mcpInRepo: true,
    extraFiles: [
      {
        path: (r) => path.join(r, '.agent', 'workflows', 'swarmdock.md'),
        render: (ctx) => buildAntigravityWorkflow(ctx),
      },
    ],
  },

  goose: {
    host: 'goose',
    displayName: 'Goose',
    ruleKind: 'managed-markdown',
    ruleFile: (r) => path.join(r, 'AGENTS.md'),
    ruleInRepo: true,
    mcpConfigFile: () => path.join(home(), '.config', 'goose', 'config.yaml'),
    mcpTransport: 'streamable-http',
    mcpFormat: 'yaml',
    mcpServersPath: 'extensions',
    mcpInRepo: false,
  },

  pi: {
    host: 'pi',
    displayName: 'Pi',
    ruleKind: 'managed-markdown',
    ruleFile: (r) => path.join(r, 'AGENTS.md'),
    ruleInRepo: true,
    mcpFormat: 'none',
  },
};
