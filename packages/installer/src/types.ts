/**
 * Supported host environments. Mirrors SwarmVault's agentTypeSchema so operators
 * who installed one tool can install the other with the same set of flags.
 */
export const AGENT_HOSTS = [
  'claude',
  'cursor',
  'vscode',
  'copilot',
  'codex',
  'gemini',
  'opencode',
  'aider',
  'trae',
  'claw',
  'droid',
  'kiro',
  'hermes',
  'antigravity',
  'goose',
  'pi',
] as const;

export type AgentHost = typeof AGENT_HOSTS[number];

export function isAgentHost(value: string): value is AgentHost {
  return (AGENT_HOSTS as readonly string[]).includes(value);
}

export interface InstallOptions {
  /** Host to install into */
  host: AgentHost;
  /** Directory root for repo-scoped writes (default: process.cwd()) */
  repoDir?: string;
  /** Named agent profile. Defaults to the current CLI default agent. */
  agentName?: string;
  /** Override the SwarmDock API URL */
  apiUrl?: string;
  /** Skip writing MCP server config even if the host supports it */
  noMcp?: boolean;
  /** Install optional session hook script (hosts that support hooks) */
  hook?: boolean;
  /** Overwrite files that were authored outside the installer */
  force?: boolean;
  /** Inject the secret as env substitution (true) or raw value (false). Auto by default. */
  envSubstitution?: boolean;
}

export interface InstallResult {
  host: AgentHost;
  agentName: string;
  agentId: string;
  did: string;
  writtenFiles: string[];
  mcpConfigured: boolean;
  gitignored: string[];
  warnings: string[];
  nextSteps: string[];
}

export interface UninstallOptions {
  host: AgentHost;
  repoDir?: string;
  agentName?: string;
}

export interface UninstallResult {
  host: AgentHost;
  removedFiles: string[];
  mutatedFiles: string[];
  warnings: string[];
}

export interface AgentCredentials {
  agentId: string;
  did: string;
  publicKey: string;
  privateKey: string;
  aat: string;
  apiUrl: string;
  createdAt: string;
  installedHosts: AgentHost[];
}

export type McpTransport = 'streamable-http' | 'stdio';

export interface McpServerConfig {
  type?: McpTransport;
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
  env?: Record<string, string>;
}

/**
 * Rule delivery kinds determine which file template is rendered.
 */
export type RuleKind =
  | 'managed-markdown'   // <!-- swarmdock:managed:start --> block inside existing file
  | 'cursor-rule'        // .mdc file with YAML frontmatter
  | 'vscode-chatmode'    // .chatmode.md with chatmode frontmatter
  | 'skill-file'         // SKILL.md with swarmdock frontmatter
  | 'skill-steering'     // Kiro: skill file + additional steering rule
  | 'aider-conventions'  // CONVENTIONS.md plus .aider.conf.yml append
  | 'antigravity'        // .agent/rules + .agent/workflows
  | 'standalone-md';     // plain markdown at a specific path

export type McpConfigFormat = 'json' | 'toml' | 'yaml' | 'none';

export interface HostDescriptor {
  host: AgentHost;
  displayName: string;
  /** Human-facing label shown in install output */
  ruleKind: RuleKind;
  /** Rule file target relative to repoDir (or absolute when starts with ~/ or /) */
  ruleFile: (repoDir: string) => string;
  /** MCP config target, if the host supports MCP (relative to repoDir) */
  mcpConfigFile?: (repoDir: string) => string;
  /** Transport the MCP config should use */
  mcpTransport?: McpTransport;
  /** MCP config file format */
  mcpFormat?: McpConfigFormat;
  /** Path inside the MCP config where the server map lives (dot path) */
  mcpServersPath?: string;
  /** True if the MCP config file is inside the repo (needs .gitignore guard for raw secrets) */
  mcpInRepo?: boolean;
  /** True if the rule file is inside the repo (same reason) */
  ruleInRepo?: boolean;
  /** Whether the host supports a post-install hook script */
  supportsHook?: boolean;
  /** Hook destination resolver; receives repoDir */
  hookPath?: (repoDir: string) => string;
  /** Hook settings file resolver (JSON file where hook is registered) */
  hookSettingsFile?: (repoDir: string) => string;
  /** Extra files to write alongside the primary rule file, relative to repoDir */
  extraFiles?: Array<{
    path: (repoDir: string) => string;
    render: (ctx: RuleRenderContext) => string;
    /** If true, only write when the file doesn't already exist */
    createOnly?: boolean;
  }>;
}

export interface RuleRenderContext {
  apiUrl: string;
  agentName: string;
  agentId: string;
  did: string;
  envVarName: string;
  credentialsPath: string;
}
