import path from 'node:path';
import { unlink } from 'node:fs/promises';
import {
  AGENT_ENV_VAR,
  DEFAULT_API_URL,
  ensureAgentIdentity,
  getAgentCredentialsPath,
  loadAgent,
  markHostInstalled,
  markHostUninstalled,
  resolveDefaultAgentName,
} from './credentials.js';
import { HOST_REGISTRY } from './hosts.js';
import { mergeMcpConfig, removeMcpEntry } from './mcp-config.js';
import {
  buildAiderConventions,
  buildAntigravityRule,
  buildCursorRule,
  buildHookScript,
  buildManagedBody,
  buildSkillFile,
  buildVscodeChatmode,
  hasManagedBlock,
  hasSwarmdockFrontmatter,
  removeManagedBlock,
  upsertManagedBlock,
} from './rules.js';
import type {
  AgentHost,
  AgentCredentials,
  HostDescriptor,
  InstallOptions,
  InstallResult,
  McpServerConfig,
  RuleRenderContext,
  UninstallOptions,
  UninstallResult,
} from './types.js';
import { AGENT_HOSTS, isAgentHost } from './types.js';
import {
  appendToGitignore,
  displayPath,
  fileExists,
  readFileSafe,
  writeFileMode,
} from './utils.js';

const MCP_REMOTE_URL = 'https://www.swarmdock.ai/mcp';
const ENV_PLACEHOLDER = `\${${AGENT_ENV_VAR}}`;

export function listHosts(): Array<{ host: AgentHost; displayName: string; mcp: boolean }> {
  return AGENT_HOSTS.map((host) => {
    const desc = HOST_REGISTRY[host];
    return {
      host,
      displayName: desc.displayName,
      mcp: Boolean(desc.mcpConfigFile),
    };
  });
}

function buildRuleContext(agentName: string, creds: AgentCredentials): RuleRenderContext {
  return {
    agentName,
    agentId: creds.agentId,
    did: creds.did,
    apiUrl: creds.apiUrl,
    envVarName: AGENT_ENV_VAR,
    credentialsPath: displayPath(getAgentCredentialsPath(agentName)),
  };
}

function renderRuleFileContent(
  desc: HostDescriptor,
  existing: string | null,
  ctx: RuleRenderContext,
): { content: string; created: boolean } {
  switch (desc.ruleKind) {
    case 'managed-markdown': {
      const body = buildManagedBody(ctx);
      const next = upsertManagedBlock(existing ?? '', body);
      return { content: next, created: !existing };
    }
    case 'cursor-rule':
      return { content: buildCursorRule(ctx) + '\n', created: !existing };
    case 'vscode-chatmode':
      return { content: buildVscodeChatmode(ctx) + '\n', created: !existing };
    case 'skill-file':
    case 'skill-steering':
      return { content: buildSkillFile(ctx) + '\n', created: !existing };
    case 'aider-conventions':
      return { content: buildAiderConventions(ctx), created: !existing };
    case 'antigravity':
      return { content: buildAntigravityRule(ctx) + '\n', created: !existing };
    case 'standalone-md':
      return { content: buildSkillFile(ctx) + '\n', created: !existing };
  }
}

function buildMcpServerConfig(desc: HostDescriptor): McpServerConfig {
  if (desc.mcpTransport === 'stdio') {
    return {
      command: 'npx',
      args: ['-y', 'swarmdock-mcp'],
      env: {
        [AGENT_ENV_VAR]: ENV_PLACEHOLDER,
        SWARMDOCK_API_URL: DEFAULT_API_URL,
      },
    };
  }
  return {
    type: 'streamable-http',
    url: MCP_REMOTE_URL,
    headers: {
      Authorization: `Bearer ${ENV_PLACEHOLDER}`,
    },
  };
}

function canOverwriteRuleFile(
  desc: HostDescriptor,
  existing: string,
  force: boolean,
): boolean {
  if (force) return true;
  switch (desc.ruleKind) {
    case 'managed-markdown':
    case 'aider-conventions':
      return true; // always safe: we only replace the managed block
    case 'cursor-rule':
    case 'vscode-chatmode':
    case 'skill-file':
    case 'skill-steering':
    case 'antigravity':
    case 'standalone-md':
      return hasSwarmdockFrontmatter(existing);
  }
}

export async function install(options: InstallOptions): Promise<InstallResult> {
  if (!isAgentHost(options.host)) {
    throw new Error(`Unknown host: ${options.host}. Supported: ${AGENT_HOSTS.join(', ')}`);
  }
  const desc = HOST_REGISTRY[options.host];
  const repoDir = path.resolve(options.repoDir ?? process.cwd());

  const agentName = options.agentName ?? (await resolveDefaultAgentName()) ?? 'default';
  const creds = await ensureAgentIdentity({
    agentName,
    apiUrl: options.apiUrl,
  });

  const ctx = buildRuleContext(agentName, creds);
  const written: string[] = [];
  const gitignored: string[] = [];
  const warnings: string[] = [];

  // --- Primary rule/skill file ---
  const ruleFile = desc.ruleFile(repoDir);
  const existingRule = await readFileSafe(ruleFile);
  if (existingRule && !canOverwriteRuleFile(desc, existingRule, Boolean(options.force))) {
    throw new Error(
      `${ruleFile} exists and was not authored by the swarmdock installer. Re-run with --force to overwrite.`,
    );
  }
  const rendered = renderRuleFileContent(desc, existingRule, ctx);
  await writeFileMode(ruleFile, rendered.content);
  written.push(ruleFile);

  // --- MCP config ---
  let mcpConfigured = false;
  if (desc.mcpConfigFile && desc.mcpFormat && desc.mcpFormat !== 'none' && !options.noMcp) {
    const mcpFile = desc.mcpConfigFile(repoDir);
    const existingMcp = await readFileSafe(mcpFile);
    const server = buildMcpServerConfig(desc);
    const merged = mergeMcpConfig(
      desc.mcpFormat,
      existingMcp,
      desc.mcpServersPath ?? 'mcpServers',
      server,
    );
    if (merged.warning) warnings.push(`${mcpFile}: ${merged.warning}`);
    await writeFileMode(mcpFile, merged.content);
    written.push(mcpFile);
    mcpConfigured = true;

    if (desc.mcpInRepo) {
      const rel = path.relative(repoDir, mcpFile);
      if (!rel.startsWith('..')) {
        const added = await appendToGitignore(repoDir, rel);
        if (added) gitignored.push(rel);
      }
    }
  }

  // --- Extra files ---
  for (const extra of desc.extraFiles ?? []) {
    const targetPath = extra.path(repoDir);
    if (extra.createOnly && (await fileExists(targetPath))) continue;
    const content = extra.render(ctx);
    if (content.length === 0) continue;
    await writeFileMode(targetPath, content);
    written.push(targetPath);
  }

  // --- Hook script ---
  if (options.hook && desc.supportsHook && desc.hookPath) {
    const hookFile = desc.hookPath(repoDir);
    await writeFileMode(hookFile, buildHookScript(options.host, ctx), 0o755);
    written.push(hookFile);
  } else if (options.hook && !desc.supportsHook) {
    warnings.push(`host "${options.host}" does not support hook scripts; --hook ignored`);
  }

  // --- Gitignore for in-repo rule file (defense-in-depth — content doesn't contain secret but path may be noise) ---
  if (desc.ruleInRepo) {
    const rel = path.relative(repoDir, ruleFile);
    if (!rel.startsWith('..') && rel.startsWith('.')) {
      // Don't gitignore conventional files like CLAUDE.md or AGENTS.md; only dotfiles
      const basename = path.basename(rel);
      if (basename.startsWith('.') || rel.startsWith('.')) {
        // intentionally skipped — rule files should be committed; gitignore not needed
      }
    }
  }

  await markHostInstalled(agentName, options.host);

  const nextSteps = buildNextSteps(options.host, agentName, creds, mcpConfigured);

  return {
    host: options.host,
    agentName,
    agentId: creds.agentId,
    did: creds.did,
    writtenFiles: written,
    mcpConfigured,
    gitignored,
    warnings,
    nextSteps,
  };
}

function buildNextSteps(
  host: AgentHost,
  agentName: string,
  creds: AgentCredentials,
  mcpConfigured: boolean,
): string[] {
  const steps: string[] = [];
  steps.push(
    `Export your agent key: export ${AGENT_ENV_VAR}=$(jq -r .privateKey ${displayPath(getAgentCredentialsPath(agentName))})`,
  );
  if (mcpConfigured) {
    steps.push(`Restart ${HOST_REGISTRY[host].displayName} so it picks up the new MCP server.`);
    steps.push('Try: "Use swarmdock_task_list to show me open tasks"');
  } else {
    steps.push(`${HOST_REGISTRY[host].displayName} does not natively support MCP. Use the \`swarmdock\` CLI or \`@swarmdock/sdk\` for marketplace calls.`);
  }
  steps.push(`Status:    swarmdock status`);
  steps.push(`DID:       ${creds.did}`);
  return steps;
}

export async function uninstall(options: UninstallOptions): Promise<UninstallResult> {
  if (!isAgentHost(options.host)) {
    throw new Error(`Unknown host: ${options.host}`);
  }
  const desc = HOST_REGISTRY[options.host];
  const repoDir = path.resolve(options.repoDir ?? process.cwd());
  const agentName = options.agentName ?? (await resolveDefaultAgentName()) ?? 'default';

  const removed: string[] = [];
  const mutated: string[] = [];
  const warnings: string[] = [];

  const ruleFile = desc.ruleFile(repoDir);
  const existing = await readFileSafe(ruleFile);
  if (existing) {
    if (desc.ruleKind === 'managed-markdown' || desc.ruleKind === 'aider-conventions') {
      if (hasManagedBlock(existing)) {
        const next = removeManagedBlock(existing);
        if (next.trim().length === 0) {
          await unlink(ruleFile);
          removed.push(ruleFile);
        } else {
          await writeFileMode(ruleFile, next);
          mutated.push(ruleFile);
        }
      }
    } else if (hasSwarmdockFrontmatter(existing)) {
      await unlink(ruleFile);
      removed.push(ruleFile);
    } else {
      warnings.push(`${ruleFile}: not authored by swarmdock-installer; left alone`);
    }
  }

  for (const extra of desc.extraFiles ?? []) {
    const p = extra.path(repoDir);
    const e = await readFileSafe(p);
    if (!e) continue;
    if (extra.createOnly) continue;
    if (hasSwarmdockFrontmatter(e) || p.endsWith('.aider.conf.yml')) {
      await unlink(p);
      removed.push(p);
    }
  }

  if (desc.mcpConfigFile && desc.mcpFormat && desc.mcpFormat !== 'none') {
    const mcpFile = desc.mcpConfigFile(repoDir);
    const e = await readFileSafe(mcpFile);
    if (e) {
      const merged = removeMcpEntry(desc.mcpFormat, e, desc.mcpServersPath ?? 'mcpServers');
      if (merged.warning) warnings.push(`${mcpFile}: ${merged.warning}`);
      await writeFileMode(mcpFile, merged.content);
      mutated.push(mcpFile);
    }
  }

  if (desc.hookPath && desc.supportsHook) {
    const hookFile = desc.hookPath(repoDir);
    if (await fileExists(hookFile)) {
      await unlink(hookFile);
      removed.push(hookFile);
    }
  }

  const creds = await loadAgent(agentName);
  if (creds) await markHostUninstalled(agentName, options.host);

  return {
    host: options.host,
    removedFiles: removed,
    mutatedFiles: mutated,
    warnings,
  };
}
