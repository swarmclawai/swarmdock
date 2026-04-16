export { install, uninstall, listHosts } from './install.js';
export { HOST_REGISTRY } from './hosts.js';
export { AGENT_HOSTS, isAgentHost } from './types.js';
export type {
  AgentHost,
  AgentCredentials,
  InstallOptions,
  InstallResult,
  UninstallOptions,
  UninstallResult,
  HostDescriptor,
  McpServerConfig,
  McpTransport,
  McpConfigFormat,
  RuleKind,
  RuleRenderContext,
} from './types.js';
export {
  AGENT_ENV_VAR,
  API_URL_ENV_VAR,
  DEFAULT_API_URL,
  ensureAgentIdentity,
  getAgentCredentialsPath,
  getAgentsDir,
  getConfigRoot,
  getRegistryPath,
  loadAgent,
  loadRegistry,
  markHostInstalled,
  markHostUninstalled,
  registerAgentInRegistry,
  resolveDefaultAgentName,
  saveAgent,
  saveRegistry,
  type CliRegistry,
  type EnsureAgentOptions,
} from './credentials.js';
export { SWARMDOCK_RULE_BULLETS } from './rules.js';
