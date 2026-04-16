import { homedir } from 'node:os';
import path from 'node:path';
import { SwarmDockClient, type RegisterParams } from '@swarmdock/sdk';
import type { AgentCredentials, AgentHost } from './types.js';
import { ensureDir, fileExists, readFileSafe, writeFileMode } from './utils.js';

export const DEFAULT_API_URL = 'https://swarmdock-api.onrender.com';
export const AGENT_ENV_VAR = 'SWARMDOCK_AGENT_PRIVATE_KEY';
export const API_URL_ENV_VAR = 'SWARMDOCK_API_URL';

export function getConfigRoot(): string {
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  const root = xdg && xdg.length > 0 ? xdg : path.join(homedir(), '.config');
  return path.join(root, 'swarmdock');
}

export function getAgentsDir(): string {
  return path.join(getConfigRoot(), 'agents');
}

export function getAgentCredentialsPath(agentName: string): string {
  return path.join(getAgentsDir(), `${agentName}.json`);
}

export function getRegistryPath(): string {
  return path.join(getConfigRoot(), 'config.json');
}

export interface CliRegistry {
  apiUrl?: string;
  /** Legacy single-profile config compatibility */
  profile?: {
    agentId?: string;
    did?: string;
    displayName?: string;
    walletAddress?: string;
    [key: string]: unknown;
  };
  agents?: Record<string, { path: string; default?: boolean }>;
}

export async function loadRegistry(): Promise<CliRegistry> {
  const raw = await readFileSafe(getRegistryPath());
  if (!raw) return {};
  try {
    return JSON.parse(raw) as CliRegistry;
  } catch {
    return {};
  }
}

export async function saveRegistry(registry: CliRegistry): Promise<void> {
  await writeFileMode(getRegistryPath(), JSON.stringify(registry, null, 2) + '\n');
}

export async function loadAgent(agentName: string): Promise<AgentCredentials | null> {
  const raw = await readFileSafe(getAgentCredentialsPath(agentName));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AgentCredentials;
  } catch {
    return null;
  }
}

export async function saveAgent(agentName: string, creds: AgentCredentials): Promise<void> {
  const p = getAgentCredentialsPath(agentName);
  await ensureDir(path.dirname(p));
  await writeFileMode(p, JSON.stringify(creds, null, 2) + '\n', 0o600);
}

export async function resolveDefaultAgentName(): Promise<string | null> {
  const registry = await loadRegistry();
  if (registry.agents) {
    const entries = Object.entries(registry.agents);
    const def = entries.find(([, v]) => v.default);
    if (def) return def[0];
    if (entries.length === 1) return entries[0][0];
  }
  return null;
}

export async function registerAgentInRegistry(agentName: string, makeDefault: boolean): Promise<void> {
  const registry = await loadRegistry();
  registry.agents = registry.agents ?? {};
  const existing = registry.agents[agentName];
  registry.agents[agentName] = {
    path: getAgentCredentialsPath(agentName),
    default: makeDefault || existing?.default === true || Object.keys(registry.agents).length === 0,
  };
  if (makeDefault) {
    for (const [name, entry] of Object.entries(registry.agents)) {
      if (name !== agentName && entry.default) entry.default = false;
    }
  }
  await saveRegistry(registry);
}

export interface EnsureAgentOptions {
  agentName: string;
  apiUrl?: string;
  walletAddress?: string;
  registerParams?: Partial<RegisterParams>;
}

/**
 * Load an agent's credentials or bootstrap a new one by generating keys +
 * hitting the SwarmDock register endpoint. Idempotent — re-running on an
 * already-registered agent just loads the existing record.
 */
export async function ensureAgentIdentity(options: EnsureAgentOptions): Promise<AgentCredentials> {
  const existing = await loadAgent(options.agentName);
  const apiUrl = options.apiUrl
    ?? existing?.apiUrl
    ?? process.env[API_URL_ENV_VAR]
    ?? DEFAULT_API_URL;

  if (existing) {
    // Refresh API URL if operator passed a new one but otherwise reuse as-is.
    if (options.apiUrl && options.apiUrl !== existing.apiUrl) {
      const updated = { ...existing, apiUrl: options.apiUrl };
      await saveAgent(options.agentName, updated);
      return updated;
    }
    return existing;
  }

  const keys = SwarmDockClient.generateKeys();
  const client = new SwarmDockClient({ baseUrl: apiUrl, privateKey: keys.privateKey });

  const registerPayload: RegisterParams = {
    displayName: options.registerParams?.displayName ?? options.agentName,
    description: options.registerParams?.description,
    framework: options.registerParams?.framework ?? 'swarmdock-installer',
    frameworkVersion: options.registerParams?.frameworkVersion,
    modelProvider: options.registerParams?.modelProvider,
    modelName: options.registerParams?.modelName,
    walletAddress: options.walletAddress ?? options.registerParams?.walletAddress ?? '',
    agentCardUrl: options.registerParams?.agentCardUrl,
    skills: options.registerParams?.skills ?? [],
  };

  const result = await client.register(registerPayload);

  const creds: AgentCredentials = {
    agentId: result.agent.id,
    did: result.agent.did,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    aat: result.token,
    apiUrl,
    createdAt: new Date().toISOString(),
    installedHosts: [],
  };

  await saveAgent(options.agentName, creds);
  await registerAgentInRegistry(options.agentName, true);
  return creds;
}

export async function markHostInstalled(agentName: string, host: AgentHost): Promise<void> {
  const creds = await loadAgent(agentName);
  if (!creds) return;
  if (!creds.installedHosts.includes(host)) {
    creds.installedHosts = [...creds.installedHosts, host].sort() as AgentHost[];
    await saveAgent(agentName, creds);
  }
}

export async function markHostUninstalled(agentName: string, host: AgentHost): Promise<void> {
  const creds = await loadAgent(agentName);
  if (!creds) return;
  const filtered = creds.installedHosts.filter((h) => h !== host);
  if (filtered.length !== creds.installedHosts.length) {
    creds.installedHosts = filtered;
    await saveAgent(agentName, creds);
  }
}

export async function agentCredentialsExist(agentName: string): Promise<boolean> {
  return fileExists(getAgentCredentialsPath(agentName));
}
