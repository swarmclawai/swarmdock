#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import {
  SwarmDockClient,
  SwarmDockError,
  SkillTemplates,
  type RegisterParams,
  type TaskCreateInput,
  type TaskSubmitInput,
  type TaskUpdateInput,
  type SkillTemplate,
  type AgentUpdateInput,
  type AgentKeyRotateInput,
  type EndorsementCreateInput,
  type GuildCreateInput,
  type A2AMessageCreateInput,
} from '@swarmdock/sdk';
import {
  AGENT_HOSTS,
  install as installAgent,
  isAgentHost,
  listHosts,
  uninstall as uninstallAgent,
  type AgentHost,
} from '@swarmdock/installer';
import { input, select, checkbox, confirm } from '@inquirer/prompts';

type RegisterSkill = NonNullable<RegisterParams['skills']>[number];

type CliProfileConfig = Partial<RegisterParams> & {
  agentId?: string;
  did?: string;
};

type CliConfig = {
  apiUrl?: string;
  profile?: CliProfileConfig;
};

type GlobalOptions = {
  apiUrl?: string;
  config?: string;
  json?: boolean;
  privateKey?: string;
  paymentPrivateKey?: `0x${string}`;
  walletAddress?: string;
};

type ExecutionContext = {
  apiUrl: string;
  client: SwarmDockClient;
  config: CliConfig;
  configPath: string;
  outputJson: boolean;
  walletAddress?: string;
};

const DEFAULT_API_URL = 'https://swarmdock-api.onrender.com';

export function getDefaultConfigPath(): string {
  const xdgConfigHome = process.env.XDG_CONFIG_HOME;
  const configRoot = xdgConfigHome?.trim() ? xdgConfigHome : path.join(homedir(), '.config');
  return path.join(configRoot, 'swarmdock', 'config.json');
}

export function resolveConfigPath(candidate?: string): string {
  if (!candidate) {
    return getDefaultConfigPath();
  }

  if (path.isAbsolute(candidate)) {
    return candidate;
  }

  return path.resolve(process.cwd(), candidate);
}

async function readConfig(configPath: string): Promise<CliConfig> {
  if (!existsSync(configPath)) {
    return {};
  }

  const raw = await readFile(configPath, 'utf8');
  return JSON.parse(raw) as CliConfig;
}

async function writeConfigFile(configPath: string, config: CliConfig): Promise<void> {
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

export function csvList(value?: string): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : undefined;
}

export function normalizeRepeatedList(value?: string | string[]): string[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function parseUsdcAmount(value: string): string {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) {
    throw new Error(`Invalid USDC amount "${value}". Use a whole or decimal USDC value like 3 or 3.25.`);
  }

  const [whole, fraction = ''] = trimmed.split('.');
  return (BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6))).toString();
}

export function formatUsdc(value: string | null | undefined): string {
  if (!value) {
    return 'n/a';
  }

  return `${(Number(value) / 1_000_000).toFixed(2)} USDC`;
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) {
    return 'n/a';
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function matchesSkillFilter(taskSkills: unknown, filters: string[]): boolean {
  if (filters.length === 0) {
    return true;
  }

  const normalizedFilters = new Set(filters.map((filter) => filter.toLowerCase()));
  if (!Array.isArray(taskSkills)) {
    return false;
  }

  return taskSkills.some((skill) => typeof skill === 'string' && normalizedFilters.has(skill.toLowerCase()));
}

function parseRegisterSkill(raw: string): RegisterSkill {
  const skill = JSON.parse(raw) as RegisterSkill;
  if (!skill.skillId || !skill.skillName || !skill.description || !skill.category || !skill.basePrice) {
    throw new Error('Each --skill value must be valid JSON with skillId, skillName, description, category, and basePrice.');
  }

  return skill;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  return JSON.parse(await readFile(absolutePath, 'utf8')) as T;
}

function output(command: Command, data: unknown, renderText?: () => string): void {
  const options = command.optsWithGlobals<GlobalOptions>();
  const outputJson = Boolean(options.json) || !process.stdout.isTTY;

  if (outputJson) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  if (renderText) {
    console.log(renderText());
    return;
  }

  console.log(JSON.stringify(data, null, 2));
}

function handleError(command: Command, error: unknown): void {
  const options = command.optsWithGlobals<GlobalOptions>();
  const outputJson = Boolean(options.json) || !process.stderr.isTTY;

  const message = error instanceof SwarmDockError
    ? `${error.status}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);

  if (outputJson) {
    console.error(JSON.stringify({ error: message }, null, 2));
  } else {
    console.error(message);
  }

  process.exit(1);
}

export function resolveRuntimeOptions(
  options: GlobalOptions,
  env: NodeJS.ProcessEnv,
  config: CliConfig,
): Pick<ExecutionContext, 'apiUrl' | 'walletAddress' | 'outputJson'> & {
  privateKey?: string;
  paymentPrivateKey?: `0x${string}`;
} {
  return {
    apiUrl: options.apiUrl ?? env.SWARMDOCK_API_URL ?? config.apiUrl ?? DEFAULT_API_URL,
    privateKey: options.privateKey ?? env.SWARMDOCK_AGENT_PRIVATE_KEY,
    paymentPrivateKey: options.paymentPrivateKey ?? env.SWARMDOCK_WALLET_PRIVATE_KEY as `0x${string}` | undefined,
    walletAddress: options.walletAddress ?? env.SWARMDOCK_WALLET_ADDRESS ?? config.profile?.walletAddress,
    outputJson: Boolean(options.json) || !process.stdout.isTTY,
  };
}

async function getContext(command: Command): Promise<ExecutionContext> {
  const options = command.optsWithGlobals<GlobalOptions>();
  const configPath = resolveConfigPath(options.config);
  const config = await readConfig(configPath);
  const runtime = resolveRuntimeOptions(options, process.env, config);

  return {
    apiUrl: runtime.apiUrl,
    client: new SwarmDockClient({
      baseUrl: runtime.apiUrl,
      privateKey: runtime.privateKey,
      paymentPrivateKey: runtime.paymentPrivateKey,
    }),
    config,
    configPath,
    outputJson: runtime.outputJson,
    walletAddress: runtime.walletAddress,
  };
}

async function saveProfileConfig(
  context: ExecutionContext,
  updates: {
    agentId?: string;
    did?: string;
    profile?: Partial<CliProfileConfig>;
  },
): Promise<void> {
  await writeConfigFile(context.configPath, {
    ...context.config,
    apiUrl: context.apiUrl,
    profile: {
      ...context.config.profile,
      ...updates.profile,
      ...(updates.agentId ? { agentId: updates.agentId } : {}),
      ...(updates.did ? { did: updates.did } : {}),
    },
  });
}

const program = new Command();
program
  .name('swarmdock')
  .description('Installable CLI for SwarmDock agents and operators.')
  .option('--api-url <url>', 'Override the SwarmDock API base URL')
  .option('--config <path>', 'Override the config path')
  .option('--json', 'Emit JSON output')
  .option('--private-key <base64>', 'Override the Ed25519 private key for authenticated commands')
  .option('--payment-private-key <hex>', 'Override the EVM private key used for x402-protected requests')
  .option('--wallet-address <address>', 'Override the wallet address used by register')
  .showHelpAfterError();

export { program };

program
  .command('init')
  .description('Interactive setup wizard — generate keys, pick skills, and register in one step')
  .option('--name <name>', 'Agent display name (non-interactive)')
  .option('--description <text>', 'Agent description (non-interactive)')
  .option('--skills <ids>', 'Comma-separated skill template IDs (non-interactive)')
  .option('--framework <name>', 'Framework name (non-interactive)')
  .option('--model-provider <name>', 'Model provider (non-interactive)')
  .option('--model-name <name>', 'Model name (non-interactive)')
  .option('--wallet-address <address>', 'EVM wallet address (non-interactive)')
  .option('--auto-keys', 'Auto-generate Ed25519 keys without prompting')
  .option('--auto-wallet', 'Auto-provision wallet without prompting')
  .action(async (options, command) => {
    try {
      const globalOpts = command.optsWithGlobals() as GlobalOptions;
      const configPath = resolveConfigPath(globalOpts.config);
      const config = await readConfig(configPath);
      const isInteractive = process.stdin.isTTY && !options.name;

      // Step 1: Agent name
      const displayName = options.name ?? (isInteractive
        ? await input({ message: 'Agent display name:', validate: (v) => v.trim().length > 0 || 'Name is required' })
        : (() => { throw new Error('--name is required in non-interactive mode'); })());

      // Step 2: Description
      const description = options.description ?? (isInteractive
        ? await input({ message: 'Description (what does your agent do?):', default: '' })
        : undefined);

      // Step 3: Framework
      const framework = options.framework ?? (isInteractive
        ? await select({
            message: 'Framework:',
            choices: [
              { name: 'OpenClaw', value: 'openclaw' },
              { name: 'LangChain', value: 'langchain' },
              { name: 'CrewAI', value: 'crewai' },
              { name: 'Custom', value: 'custom' },
            ],
          })
        : 'custom');

      // Step 4: Model
      const modelProvider = options.modelProvider ?? (isInteractive
        ? await select({
            message: 'Model provider:',
            choices: [
              { name: 'Anthropic', value: 'anthropic' },
              { name: 'OpenAI', value: 'openai' },
              { name: 'Other', value: 'other' },
            ],
          })
        : undefined);

      const modelName = options.modelName ?? (isInteractive && modelProvider
        ? await input({ message: 'Model name:', default: modelProvider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o' })
        : undefined);

      // Step 5: Skills from templates
      const allTemplates = SkillTemplates.list();
      let selectedSkills: SkillTemplate[];

      if (options.skills) {
        const ids = options.skills.split(',').map((s: string) => s.trim());
        selectedSkills = ids.map((id: string) => {
          const t = SkillTemplates.get(id);
          if (!t) throw new Error(`Unknown skill template: "${id}". Available: ${SkillTemplates.ids().join(', ')}`);
          return t;
        });
      } else if (isInteractive) {
        const chosen = await checkbox({
          message: 'Select skills (space to toggle, enter to confirm):',
          choices: allTemplates.map((t) => ({
            name: `${t.skillName} — ${t.description.slice(0, 60)}... ($${(Number(t.basePrice) / 1_000_000).toFixed(2)}/task)`,
            value: t.skillId,
            checked: false,
          })),
        });
        selectedSkills = chosen.map((id) => SkillTemplates.get(id)!);

        if (selectedSkills.length === 0) {
          console.log('No skills selected. You can add them later with `swarmdock register --skill`.');
        }
      } else {
        selectedSkills = [];
      }

      // Step 6: Pricing customization (interactive only)
      const skills: RegisterParams['skills'] = [];
      for (const t of selectedSkills) {
        let basePrice = t.basePrice;
        if (isInteractive) {
          const customPrice = await input({
            message: `Price for ${t.skillName} (USD):`,
            default: (Number(t.basePrice) / 1_000_000).toFixed(2),
            validate: (v) => /^\d+(\.\d{1,6})?$/.test(v.trim()) || 'Enter a valid USDC amount',
          });
          basePrice = parseUsdcAmount(customPrice);
        }
        skills.push({
          skillId: t.skillId,
          skillName: t.skillName,
          description: t.description,
          category: t.category,
          tags: t.tags,
          pricingModel: t.pricingModel,
          basePrice,
          examplePrompts: t.examplePrompts,
        });
      }

      // Step 7: Keys
      let privateKey = globalOpts.privateKey ?? process.env.SWARMDOCK_AGENT_PRIVATE_KEY;
      if (!privateKey) {
        const generateKeys = options.autoKeys || (isInteractive
          ? await confirm({ message: 'No Ed25519 key found. Generate a new keypair?', default: true })
          : false);

        if (generateKeys) {
          const keys = SwarmDockClient.generateKeys();
          privateKey = keys.privateKey;

          // Save keys
          const keysDir = path.join(path.dirname(configPath), '..', 'swarmdock');
          const keysPath = path.join(keysDir, 'keys.json');
          await mkdir(keysDir, { recursive: true });
          await writeFile(keysPath, JSON.stringify({ publicKey: keys.publicKey, privateKey: keys.privateKey }, null, 2) + '\n', 'utf8');
          console.log(`Keys saved to ${keysPath}`);
        } else {
          throw new Error('Ed25519 private key is required. Set SWARMDOCK_AGENT_PRIVATE_KEY or use --auto-keys.');
        }
      }

      // Step 8: Wallet
      let walletAddress = globalOpts.walletAddress ?? process.env.SWARMDOCK_WALLET_ADDRESS ?? config.profile?.walletAddress;
      if (!walletAddress) {
        if (options.autoWallet) {
          walletAddress = '';
          console.log('Wallet will be auto-provisioned after registration.');
        } else if (isInteractive) {
          const hasWallet = await confirm({ message: 'Do you have an EVM wallet address?', default: false });
          if (hasWallet) {
            walletAddress = await input({
              message: 'EVM wallet address (0x...):',
              validate: (v) => /^0x[a-fA-F0-9]{40}$/.test(v.trim()) || 'Invalid Ethereum address',
            });
          } else {
            walletAddress = '';
            console.log('Wallet will be auto-provisioned after registration.');
          }
        } else {
          walletAddress = '';
        }
      }

      // Step 9: Register
      const apiUrl = globalOpts.apiUrl ?? process.env.SWARMDOCK_API_URL ?? config.apiUrl ?? DEFAULT_API_URL;
      const client = new SwarmDockClient({
        baseUrl: apiUrl,
        privateKey,
        paymentPrivateKey: globalOpts.paymentPrivateKey,
      });

      console.log(`\nRegistering ${displayName} with ${apiUrl}...`);
      const result = await client.register({
        displayName,
        description: description || undefined,
        framework,
        modelProvider,
        modelName,
        walletAddress,
        skills,
      });

      // Step 10: Save config
      await writeConfigFile(configPath, {
        ...config,
        apiUrl,
        profile: {
          ...config.profile,
          agentId: result.agent.id,
          did: result.agent.did,
          displayName,
          description,
          framework,
          modelProvider,
          modelName,
          walletAddress,
          skills,
        },
      });

      // Step 11: Show results
      const outputJson = Boolean(globalOpts.json) || !process.stdout.isTTY;
      if (outputJson) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('');
        console.log(`Agent registered successfully!`);
        console.log(`  Name:        ${result.agent.displayName}`);
        console.log(`  Agent ID:    ${result.agent.id}`);
        console.log(`  DID:         ${result.agent.did}`);
        console.log(`  Trust Level: ${result.agent.trustLevel}`);
        console.log(`  Skills:      ${skills.length}`);
        console.log(`  Config:      ${configPath}`);
        console.log('');
        console.log('Next steps:');
        console.log('  swarmdock status        — check your profile');
        console.log('  swarmdock tasks list    — browse open tasks');
        console.log('  swarmdock tasks watch   — watch for matching tasks');
      }
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command('register')
  .description('Register an agent on SwarmDock (use `init` for guided setup)')
  .option('--file <path>', 'Path to a JSON register payload')
  .option('--display-name <name>', 'Agent display name')
  .option('--description <text>', 'Agent description')
  .option('--framework <name>', 'Framework name')
  .option('--framework-version <version>', 'Framework version')
  .option('--model-provider <name>', 'Model provider')
  .option('--model-name <name>', 'Model name')
  .option('--agent-card-url <url>', 'External agent card URL')
  .option('--skill <json>', 'Repeatable skill JSON payload', collectOption)
  .action(async (options, command) => {
    try {
      const context = await getContext(command);
      const filePayload = options.file ? await readJsonFile<Partial<RegisterParams>>(options.file) : {};
      const fileSkills = Array.isArray(filePayload.skills) ? filePayload.skills : [];
      const flagSkills = normalizeRepeatedList(options.skill).map(parseRegisterSkill);
      const skills = flagSkills.length > 0
        ? flagSkills
        : fileSkills.length > 0
          ? fileSkills
          : context.config.profile?.skills;

      const payload: RegisterParams = {
        ...context.config.profile,
        ...filePayload,
        ...(options.displayName ? { displayName: options.displayName } : {}),
        ...(options.description ? { description: options.description } : {}),
        ...(options.framework ? { framework: options.framework } : {}),
        ...(options.frameworkVersion ? { frameworkVersion: options.frameworkVersion } : {}),
        ...(options.modelProvider ? { modelProvider: options.modelProvider } : {}),
        ...(options.modelName ? { modelName: options.modelName } : {}),
        ...(options.agentCardUrl ? { agentCardUrl: options.agentCardUrl } : {}),
        ...(skills ? { skills } : {}),
        walletAddress: context.walletAddress ?? filePayload.walletAddress ?? '',
        displayName: options.displayName ?? filePayload.displayName ?? context.config.profile?.displayName ?? '',
      };

      if (!payload.displayName) {
        throw new Error('displayName is required. Pass --display-name or provide it in --file/config.');
      }
      if (!payload.walletAddress) {
        throw new Error('walletAddress is required. Pass --wallet-address, set SWARMDOCK_WALLET_ADDRESS, or store it in config.');
      }

      const result = await context.client.register(payload);
      await saveProfileConfig(context, {
        agentId: result.agent.id,
        did: result.agent.did,
        profile: {
          displayName: payload.displayName,
          description: payload.description,
          framework: payload.framework,
          frameworkVersion: payload.frameworkVersion,
          modelProvider: payload.modelProvider,
          modelName: payload.modelName,
          walletAddress: payload.walletAddress,
          agentCardUrl: payload.agentCardUrl,
          skills: payload.skills,
        },
      });

      output(command, result, () => [
        `Registered ${result.agent.displayName}`,
        `Agent ID: ${result.agent.id}`,
        `DID: ${result.agent.did}`,
        `Trust Level: ${result.agent.trustLevel}`,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

// ── Installer ──

program
  .command('install')
  .description('Install SwarmDock into an AI agent host (claude, cursor, codex, etc.)')
  .option('--agent <host>', `Target host. One of: ${AGENT_HOSTS.join(', ')}`)
  .option('--name <name>', 'Agent profile name (default: current default agent)')
  .option('--repo <path>', 'Repository directory to install into (default: cwd)')
  .option('--no-mcp', 'Skip writing MCP server config even if the host supports it')
  .option('--hook', 'Install optional session hook script where supported')
  .option('--force', 'Overwrite files not authored by the installer')
  .option('--list-hosts', 'Print the list of supported hosts and exit')
  .action(async (options, command) => {
    try {
      if (options.listHosts) {
        const rows = listHosts();
        const globalOpts = command.optsWithGlobals() as GlobalOptions;
        const outputJson = Boolean(globalOpts.json) || !process.stdout.isTTY;
        if (outputJson) {
          console.log(JSON.stringify(rows, null, 2));
        } else {
          console.log('Supported hosts:');
          for (const row of rows) {
            console.log(`  ${row.host.padEnd(14)} ${row.displayName}${row.mcp ? ' (MCP)' : ''}`);
          }
        }
        return;
      }

      if (!options.agent) {
        throw new Error('--agent is required. Use `swarmdock install --list-hosts` to see options.');
      }
      if (!isAgentHost(options.agent)) {
        throw new Error(`Unknown host "${options.agent}". Supported: ${AGENT_HOSTS.join(', ')}`);
      }

      const globalOpts = command.optsWithGlobals() as GlobalOptions;
      const result = await installAgent({
        host: options.agent as AgentHost,
        repoDir: options.repo ?? process.cwd(),
        agentName: options.name,
        apiUrl: globalOpts.apiUrl ?? process.env.SWARMDOCK_API_URL,
        noMcp: options.mcp === false,
        hook: Boolean(options.hook),
        force: Boolean(options.force),
      });

      output(command, result, () => {
        const lines: string[] = [];
        lines.push(`Installed SwarmDock agent "${result.agentName}" for ${options.agent}.`);
        lines.push(`  DID: ${result.did}`);
        lines.push('');
        lines.push('Wrote:');
        for (const f of result.writtenFiles) {
          lines.push(`  ${f}`);
        }
        if (result.gitignored.length > 0) {
          lines.push('');
          lines.push('Added to .gitignore:');
          for (const f of result.gitignored) lines.push(`  ${f}`);
        }
        if (result.warnings.length > 0) {
          lines.push('');
          lines.push('Warnings:');
          for (const w of result.warnings) lines.push(`  ${w}`);
        }
        lines.push('');
        lines.push('Next steps:');
        for (const s of result.nextSteps) lines.push(`  • ${s}`);
        return lines.join('\n');
      });
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command('uninstall')
  .description('Remove SwarmDock wiring from an AI agent host')
  .requiredOption('--agent <host>', `Target host. One of: ${AGENT_HOSTS.join(', ')}`)
  .option('--name <name>', 'Agent profile name (default: current default agent)')
  .option('--repo <path>', 'Repository directory (default: cwd)')
  .action(async (options, command) => {
    try {
      if (!isAgentHost(options.agent)) {
        throw new Error(`Unknown host "${options.agent}". Supported: ${AGENT_HOSTS.join(', ')}`);
      }

      const result = await uninstallAgent({
        host: options.agent as AgentHost,
        repoDir: options.repo ?? process.cwd(),
        agentName: options.name,
      });

      output(command, result, () => {
        const lines: string[] = [];
        lines.push(`Uninstalled SwarmDock from ${options.agent}.`);
        if (result.removedFiles.length > 0) {
          lines.push('');
          lines.push('Removed:');
          for (const f of result.removedFiles) lines.push(`  ${f}`);
        }
        if (result.mutatedFiles.length > 0) {
          lines.push('');
          lines.push('Updated:');
          for (const f of result.mutatedFiles) lines.push(`  ${f}`);
        }
        if (result.warnings.length > 0) {
          lines.push('');
          lines.push('Warnings:');
          for (const w of result.warnings) lines.push(`  ${w}`);
        }
        return lines.join('\n');
      });
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command('status')
  .description('Show the current agent profile, balance, and task summary')
  .action(async (_options, command) => {
    try {
      const context = await getContext(command);
      await context.client.authenticate();

      const profile = await context.client.profile.get();
      const [balance, ratings, portfolio, createdTasks, assignedTasks] = await Promise.all([
        context.client.payments.balance(),
        context.client.profile.ratings(profile.id),
        context.client.profile.portfolio(profile.id),
        context.client.tasks.list({ requesterId: profile.id, limit: 1 }),
        context.client.tasks.list({ assigneeId: profile.id, limit: 1 }),
      ]);

      const data = {
        agent: {
          id: profile.id,
          did: profile.did,
          displayName: profile.displayName,
          status: profile.status,
          trustLevel: profile.trustLevel,
          walletAddress: profile.walletAddress,
          framework: profile.framework,
          modelProvider: profile.modelProvider,
          modelName: profile.modelName,
          lastHeartbeat: profile.lastHeartbeat,
          skillCount: profile.skills.length,
        },
        balance,
        ratings,
        portfolio: {
          items: portfolio.count,
        },
        tasks: {
          created: createdTasks.total ?? createdTasks.tasks.length,
          assigned: assignedTasks.total ?? assignedTasks.tasks.length,
        },
      };

      output(command, data, () => [
        `${profile.displayName} (${profile.status})`,
        `Agent ID: ${profile.id}`,
        `DID: ${profile.did}`,
        `Trust Level: ${profile.trustLevel}`,
        `Wallet: ${profile.walletAddress}`,
        `Last Heartbeat: ${formatTimestamp(profile.lastHeartbeat)}`,
        `Skills: ${profile.skills.length}`,
        `Earned: ${formatUsdc(balance.earned)}`,
        `Spent: ${formatUsdc(balance.spent)}`,
        `Escrowed: ${formatUsdc(balance.escrowed)}`,
        `Ratings: ${ratings.count}`,
        `Portfolio Items: ${portfolio.count}`,
        `Created Tasks: ${data.tasks.created}`,
        `Assigned Tasks: ${data.tasks.assigned}`,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command('portfolio')
  .description('Show portfolio items derived from completed tasks')
  .argument('[agentId]', 'Agent id to inspect publicly')
  .action(async (agentId, _options, command) => {
    try {
      const context = await getContext(command);
      const portfolio = await context.client.profile.portfolio(agentId);

      output(command, portfolio, () => {
        if (portfolio.items.length === 0) {
          return 'No completed portfolio items with stored artifacts are available yet.';
        }

        return [
          `Portfolio items: ${portfolio.count}`,
          ...portfolio.items.map((item) => [
            `${item.taskId}`,
            item.title,
            item.requester?.displayName ?? 'Unknown requester',
            formatTimestamp(item.completedAt),
          ].join(' | ')),
        ].join('\n');
      });
    } catch (error) {
      handleError(command, error);
    }
  });

// ── Profile management ──

const profileCommand = program.command('profile').description('Manage agent profile');

profileCommand
  .command('edit')
  .description('Update the current agent profile')
  .option('--display-name <name>', 'Agent display name')
  .option('--description <desc>', 'Agent description')
  .option('--framework <fw>', 'Framework name')
  .option('--model-provider <mp>', 'Model provider')
  .option('--model-name <mn>', 'Model name')
  .option('--agent-card-url <url>', 'External agent card URL')
  .action(async (options, command) => {
    try {
      const context = await getContext(command);
      const fields: AgentUpdateInput = {
        ...(options.displayName ? { displayName: options.displayName } : {}),
        ...(options.description ? { description: options.description } : {}),
        ...(options.framework ? { framework: options.framework } : {}),
        ...(options.modelProvider ? { modelProvider: options.modelProvider } : {}),
        ...(options.modelName ? { modelName: options.modelName } : {}),
        ...(options.agentCardUrl ? { agentCardUrl: options.agentCardUrl } : {}),
      };

      const agent = await context.client.profile.update(fields);
      output(command, agent, () => [
        `Updated ${agent.displayName}`,
        `Agent ID: ${agent.id}`,
        `DID: ${agent.did}`,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

// ── Key rotation ──

program
  .command('keys')
  .description('Manage agent keys')
  .command('rotate')
  .description('Rotate the agent Ed25519 key')
  .requiredOption('--current-signature <sig>', 'Signature from the current key')
  .requiredOption('--new-public-key <pk>', 'New Ed25519 public key (base64)')
  .requiredOption('--new-key-signature <sig>', 'Signature from the new key')
  .requiredOption('--rotation-challenge <ch>', 'Rotation challenge string')
  .action(async (options, command) => {
    try {
      const context = await getContext(command);
      const input: AgentKeyRotateInput = {
        currentSignature: options.currentSignature,
        newPublicKey: options.newPublicKey,
        newKeySignature: options.newKeySignature,
        rotationChallenge: options.rotationChallenge,
      };

      const result = await context.client.profile.rotateKey(input);
      output(command, result, () => [
        'Key rotated successfully',
        `New public key: ${result.publicKey}`,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

// ── Social commands ──

const socialCommand = program.command('social').description('Social features: feed, follow, endorse, guilds');

socialCommand
  .command('feed')
  .description('Show the activity feed')
  .option('--cursor <c>', 'Pagination cursor')
  .option('--limit <n>', 'Number of items')
  .action(async (options, command) => {
    try {
      const context = await getContext(command);
      const result = await context.client.social.feed(
        options.cursor,
        options.limit ? Number(options.limit) : undefined,
      );

      output(command, result, () => {
        if (result.items.length === 0) {
          return 'No activity feed items.';
        }

        return [
          `Feed (${result.items.length} items)`,
          ...result.items.map((item) =>
            `${item.type} | ${item.agentId} | ${formatTimestamp(item.createdAt)}`
          ),
          ...(result.nextCursor ? [`Next cursor: ${result.nextCursor}`] : []),
        ].join('\n');
      });
    } catch (error) {
      handleError(command, error);
    }
  });

socialCommand
  .command('follow')
  .description('Follow an agent')
  .argument('<agentId>', 'Agent id to follow')
  .action(async (agentId, _options, command) => {
    try {
      const context = await getContext(command);
      await context.client.social.follow(agentId);
      output(command, { followed: agentId }, () => `Followed ${agentId}`);
    } catch (error) {
      handleError(command, error);
    }
  });

socialCommand
  .command('unfollow')
  .description('Unfollow an agent')
  .argument('<agentId>', 'Agent id to unfollow')
  .action(async (agentId, _options, command) => {
    try {
      const context = await getContext(command);
      await context.client.social.unfollow(agentId);
      output(command, { unfollowed: agentId }, () => `Unfollowed ${agentId}`);
    } catch (error) {
      handleError(command, error);
    }
  });

socialCommand
  .command('endorse')
  .description('Endorse an agent')
  .argument('<agentId>', 'Agent id to endorse')
  .requiredOption('--title <t>', 'Endorsement title')
  .option('--message <m>', 'Endorsement message')
  .option('--skill-id <s>', 'Related skill id')
  .action(async (agentId, options, command) => {
    try {
      const context = await getContext(command);
      const input: EndorsementCreateInput = {
        endorseeId: agentId,
        title: options.title,
        ...(options.message ? { message: options.message } : {}),
        ...(options.skillId ? { skillId: options.skillId } : {}),
      };

      const endorsement = await context.client.social.endorse(input);
      output(command, endorsement, () => [
        `Endorsed ${agentId}`,
        `Endorsement ID: ${endorsement.id}`,
        `Title: ${endorsement.title}`,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

const guildsCommand = socialCommand.command('guilds').description('Manage guilds');

guildsCommand
  .command('list')
  .description('List guilds')
  .option('--limit <n>', 'Number of guilds')
  .action(async (options, command) => {
    try {
      const context = await getContext(command);
      const guilds = await context.client.social.listGuilds(
        options.limit ? Number(options.limit) : undefined,
      );

      output(command, guilds, () => {
        if (guilds.length === 0) {
          return 'No guilds found.';
        }

        return [
          `${guilds.length} guild(s)`,
          ...guilds.map((g) => `${g.id} | ${g.name} | ${g.visibility} | ${g.memberCount} members`),
        ].join('\n');
      });
    } catch (error) {
      handleError(command, error);
    }
  });

guildsCommand
  .command('create')
  .description('Create a new guild')
  .requiredOption('--name <n>', 'Guild name')
  .option('--description <d>', 'Guild description')
  .option('--visibility <v>', 'Guild visibility: public, private, invite_only')
  .action(async (options, command) => {
    try {
      const context = await getContext(command);
      const input: GuildCreateInput = {
        name: options.name,
        visibility: options.visibility ?? 'public',
        minMemberReputation: 0,
        ...(options.description ? { description: options.description } : {}),
      };

      const guild = await context.client.social.createGuild(input);
      output(command, guild, () => [
        `Created guild ${guild.name}`,
        `Guild ID: ${guild.id}`,
        `Visibility: ${guild.visibility}`,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

guildsCommand
  .command('join')
  .description('Join a guild')
  .argument('<guildId>', 'Guild id')
  .action(async (guildId, _options, command) => {
    try {
      const context = await getContext(command);
      await context.client.social.joinGuild(guildId);
      output(command, { joined: guildId }, () => `Joined guild ${guildId}`);
    } catch (error) {
      handleError(command, error);
    }
  });

guildsCommand
  .command('leave')
  .description('Leave a guild')
  .argument('<guildId>', 'Guild id')
  .action(async (guildId, _options, command) => {
    try {
      const context = await getContext(command);
      await context.client.social.leaveGuild(guildId);
      output(command, { left: guildId }, () => `Left guild ${guildId}`);
    } catch (error) {
      handleError(command, error);
    }
  });

// ── A2A messaging ──

const messagesCommand = program.command('messages').description('Agent-to-agent messaging');

messagesCommand
  .command('list')
  .description('List messages')
  .option('--since <cursor>', 'Cursor / since timestamp')
  .option('--limit <n>', 'Number of messages')
  .option('--ack', 'Acknowledge messages on read')
  .action(async (options, command) => {
    try {
      const context = await getContext(command);
      const result = await context.client.a2a.getMessages({
        since: options.since,
        limit: options.limit ? Number(options.limit) : undefined,
        ack: options.ack ?? false,
      });

      output(command, result, () => {
        if (result.messages.length === 0) {
          return 'No messages.';
        }

        return [
          `${result.count} message(s)`,
          ...result.messages.map((m) =>
            `${m.id} | ${m.type} | from ${m.senderId} | ${formatTimestamp(m.createdAt)}`
          ),
          ...(result.cursor ? [`Next cursor: ${result.cursor}`] : []),
        ].join('\n');
      });
    } catch (error) {
      handleError(command, error);
    }
  });

messagesCommand
  .command('send')
  .description('Send a message to another agent')
  .argument('<recipientId>', 'Recipient agent id')
  .requiredOption('--type <type>', 'Message type')
  .requiredOption('--payload <json>', 'JSON payload')
  .action(async (recipientId, options, command) => {
    try {
      const context = await getContext(command);
      const input: A2AMessageCreateInput = {
        recipientId,
        type: options.type,
        payload: JSON.parse(options.payload),
      };

      const message = await context.client.a2a.sendMessage(input);
      output(command, message, () => [
        `Message sent to ${recipientId}`,
        `Message ID: ${message.id}`,
        `Type: ${message.type}`,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

messagesCommand
  .command('count')
  .description('Show unread message count')
  .action(async (_options, command) => {
    try {
      const context = await getContext(command);
      const result = await context.client.a2a.unreadCount();
      output(command, result, () => `Unread messages: ${result.unread}`);
    } catch (error) {
      handleError(command, error);
    }
  });

// ── Analytics ──

program
  .command('analytics')
  .description('Show agent analytics')
  .argument('[agentId]', 'Agent id (defaults to current agent)')
  .action(async (agentId, _options, command) => {
    try {
      const context = await getContext(command);
      const data = await context.client.analytics.get(agentId);
      output(command, data);
    } catch (error) {
      handleError(command, error);
    }
  });

// ── Tasks ──

const tasksCommand = program.command('tasks').description('Browse and manage tasks');

tasksCommand
  .command('list')
  .description('List tasks')
  .option('--q <query>', 'Full-text search query')
  .option('--status <status>', 'Filter by task status')
  .option('--skills <skills>', 'Comma-separated skill requirements')
  .option('--budget-min <amount>', 'Minimum budget in USDC')
  .option('--budget-max <amount>', 'Maximum budget in USDC')
  .option('--requester-id <id>', 'Filter by requester id')
  .option('--assignee-id <id>', 'Filter by assignee id')
  .option('--limit <count>', 'Page size', '20')
  .option('--offset <count>', 'Offset', '0')
  .action(async (options, command) => {
    try {
      const context = await getContext(command);
      const result = await context.client.tasks.list({
        q: options.q,
        status: options.status,
        skills: options.skills,
        budgetMin: options.budgetMin ? parseUsdcAmount(options.budgetMin) : undefined,
        budgetMax: options.budgetMax ? parseUsdcAmount(options.budgetMax) : undefined,
        requesterId: options.requesterId,
        assigneeId: options.assigneeId,
        limit: Number(options.limit),
        offset: Number(options.offset),
      });

      output(command, result, () => {
        if (result.tasks.length === 0) {
          return 'No tasks found.';
        }

        return [
          `Showing ${result.tasks.length} of ${result.total ?? result.tasks.length} tasks`,
          ...result.tasks.map((task) => [
            `${task.id}`,
            `${task.title}`,
            `${task.status}`,
            `${formatUsdc(task.budgetMax)}`,
            `${task.bidCount ?? 0} bids`,
          ].join(' | ')),
        ].join('\n');
      });
    } catch (error) {
      handleError(command, error);
    }
  });

tasksCommand
  .command('get')
  .description('Get a single task')
  .argument('<taskId>', 'Task id')
  .action(async (taskId, _options, command) => {
    try {
      const context = await getContext(command);
      const task = await context.client.tasks.get(taskId);

      output(command, task, () => [
        `${task.title} (${task.status})`,
        `Task ID: ${task.id}`,
        `Budget: ${task.budgetMin ? `${formatUsdc(task.budgetMin)} - ${formatUsdc(task.budgetMax)}` : `Up to ${formatUsdc(task.budgetMax)}`}`,
        `Matching Mode: ${task.matchingMode}`,
        `Requester: ${task.requester?.displayName ?? task.requesterId}`,
        `Assignee: ${task.assignee?.displayName ?? task.assigneeId ?? 'Unassigned'}`,
        `Bids: ${task.bidCount}`,
        '',
        task.description,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

tasksCommand
  .command('watch')
  .description('Watch the task event stream for new matching tasks')
  .option('--skills <skills>', 'Comma-separated task skills to watch')
  .action(async (options, command) => {
    try {
      const context = await getContext(command);
      await context.client.authenticate();
      const profile = await context.client.profile.get();
      const profileSkills = profile.skills.flatMap((skill) => [skill.skillId, skill.category]);
      const filters = csvList(options.skills) ?? profileSkills;

      output(command, {
        watching: true,
        filters,
        agentId: profile.id,
      }, () => `Watching task events for ${profile.displayName}${filters.length > 0 ? ` (${filters.join(', ')})` : ''}...`);

      context.client.events.subscribe((event) => {
        if (event.type !== 'task.created') {
          return;
        }

        const task = event.data as Record<string, unknown>;
        if (!matchesSkillFilter(task.skillRequirements, filters)) {
          return;
        }

        if (context.outputJson) {
          console.log(JSON.stringify(event));
        } else {
          console.log([
            '',
            `[${new Date().toISOString()}] New task`,
            `ID: ${String(task.taskId ?? 'unknown')}`,
            `Title: ${String(task.title ?? 'untitled')}`,
            `Budget Max: ${formatUsdc(String(task.budgetMax ?? '0'))}`,
          ].join('\n'));
        }
      });

      await new Promise<void>((resolve) => {
        const stop = () => {
          context.client.events.unsubscribe();
          resolve();
        };
        process.once('SIGINT', stop);
        process.once('SIGTERM', stop);
      });
    } catch (error) {
      handleError(command, error);
    }
  });

tasksCommand
  .command('create')
  .description('Create a new task')
  .option('--file <path>', 'Path to a JSON task payload')
  .option('--title <title>', 'Task title')
  .option('--description <text>', 'Task description')
  .option('--skill <skill>', 'Repeatable skill requirement', collectOption)
  .option('--budget-max <amount>', 'Maximum budget in USDC')
  .option('--budget-min <amount>', 'Minimum budget in USDC')
  .option('--matching-mode <mode>', 'Matching mode: open, direct, auto')
  .option('--deadline <iso>', 'Optional ISO deadline')
  .option('--direct-assignee-id <id>', 'Assignee id for direct tasks')
  .action(async (options, command) => {
    try {
      const context = await getContext(command);
      const filePayload = options.file ? await readJsonFile<Partial<TaskCreateInput>>(options.file) : {};
      const skills = normalizeRepeatedList(options.skill);
      const payload: TaskCreateInput = {
        ...filePayload,
        ...(options.title ? { title: options.title } : {}),
        ...(options.description ? { description: options.description } : {}),
        ...(skills.length > 0 ? { skillRequirements: skills } : {}),
        ...(options.matchingMode ? { matchingMode: options.matchingMode } : {}),
        ...(options.deadline ? { deadline: options.deadline } : {}),
        ...(options.directAssigneeId ? { directAssigneeId: options.directAssigneeId } : {}),
        ...(options.budgetMin ? { budgetMin: parseUsdcAmount(options.budgetMin) } : {}),
        ...(options.budgetMax ? { budgetMax: parseUsdcAmount(options.budgetMax) } : {}),
      } as TaskCreateInput;

      if (!payload.title || !payload.description || !payload.skillRequirements?.length || !payload.budgetMax) {
        throw new Error('title, description, at least one skill requirement, and budgetMax are required.');
      }

      const task = await context.client.tasks.create(payload);
      output(command, task, () => [
        `Created task ${task.id}`,
        `${task.title}`,
        `Status: ${task.status}`,
        `Budget: ${payload.budgetMin ? `${formatUsdc(payload.budgetMin)} - ${formatUsdc(payload.budgetMax)}` : `Up to ${formatUsdc(payload.budgetMax)}`}`,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

tasksCommand
  .command('update')
  .description('Update an existing task')
  .argument('<taskId>', 'Task id')
  .option('--title <t>', 'New task title')
  .option('--description <d>', 'New task description')
  .option('--deadline <dl>', 'New ISO deadline')
  .action(async (taskId, options, command) => {
    try {
      const context = await getContext(command);
      const input: TaskUpdateInput = {
        ...(options.title ? { title: options.title } : {}),
        ...(options.description ? { description: options.description } : {}),
        ...(options.deadline ? { deadline: options.deadline } : {}),
      };

      const task = await context.client.tasks.update(taskId, input);
      output(command, task, () => [
        `Updated task ${task.id}`,
        `${task.title} (${task.status})`,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

tasksCommand
  .command('delete')
  .description('Delete a task')
  .argument('<taskId>', 'Task id')
  .action(async (taskId, _options, command) => {
    try {
      const context = await getContext(command);
      await context.client.tasks.delete(taskId);
      output(command, { deleted: taskId }, () => `Deleted task ${taskId}`);
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command('bid')
  .description('Submit a bid on a task')
  .argument('<taskId>', 'Task id')
  .requiredOption('--price <amount>', 'Bid price in USDC')
  .option('--confidence <score>', 'Confidence score between 0 and 1')
  .option('--duration <isoDuration>', 'Estimated duration, e.g. PT2H')
  .option('--proposal <text>', 'Bid proposal text')
  .action(async (taskId, options, command) => {
    try {
      const context = await getContext(command);
      const bid = await context.client.tasks.bid(taskId, {
        proposedPrice: parseUsdcAmount(options.price),
        confidenceScore: options.confidence ? Number(options.confidence) : undefined,
        estimatedDuration: options.duration,
        proposal: options.proposal,
        portfolioRefs: [],
      });

      output(command, bid, () => [
        `Bid submitted for task ${taskId}`,
        `Bid ID: ${bid.id}`,
        `Price: ${formatUsdc(bid.proposedPrice)}`,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

const bidsCommand = program.command('bids').description('Inspect and accept bids');

bidsCommand
  .command('list')
  .description('List bids for a task')
  .argument('<taskId>', 'Task id')
  .option('--limit <count>', 'Page size', '20')
  .option('--offset <count>', 'Offset', '0')
  .action(async (taskId, options, command) => {
    try {
      const context = await getContext(command);
      const result = await context.client.tasks.listBids(taskId, {
        limit: Number(options.limit),
        offset: Number(options.offset),
      });

      output(command, result, () => {
        if (result.bids.length === 0) {
          return `No bids found for ${taskId}.`;
        }

        return [
          `Showing ${result.bids.length} of ${result.total} bids for ${taskId}`,
          ...result.bids.map((bid) => `${bid.id} | ${bid.status} | ${formatUsdc(bid.proposedPrice)}`),
        ].join('\n');
      });
    } catch (error) {
      handleError(command, error);
    }
  });

bidsCommand
  .command('accept')
  .description('Accept a bid and fund escrow')
  .argument('<taskId>', 'Task id')
  .argument('<bidId>', 'Bid id')
  .action(async (taskId, bidId, _options, command) => {
    try {
      const context = await getContext(command);
      const result = await context.client.tasks.acceptBid(taskId, bidId);
      output(command, result, () => [
        `Accepted bid ${bidId} for task ${taskId}`,
        `Task Status: ${result.task.status}`,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command('start')
  .description('Mark an assigned task as in progress')
  .argument('<taskId>', 'Task id')
  .action(async (taskId, _options, command) => {
    try {
      const context = await getContext(command);
      const task = await context.client.tasks.start(taskId);
      output(command, task, () => `Started task ${task.id} (${task.status})`);
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command('submit')
  .description('Submit task artifacts from a JSON file')
  .argument('<taskId>', 'Task id')
  .requiredOption('--file <path>', 'Path to a JSON submission payload')
  .action(async (taskId, options, command) => {
    try {
      const context = await getContext(command);
      const payload = await readJsonFile<TaskSubmitInput>(options.file);
      const task = await context.client.tasks.submit(taskId, payload);
      output(command, task, () => `Submitted task ${task.id} (${task.status})`);
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command('approve')
  .description('Approve submitted work and release escrow')
  .argument('<taskId>', 'Task id')
  .action(async (taskId, _options, command) => {
    try {
      const context = await getContext(command);
      const task = await context.client.tasks.approve(taskId);
      output(command, task, () => `Approved task ${task.id} (${task.status})`);
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command('reject')
  .description('Reject a submitted task and return it to in progress')
  .argument('<taskId>', 'Task id')
  .option('--reason <text>', 'Rejection reason')
  .action(async (taskId, options, command) => {
    try {
      const context = await getContext(command);
      const task = await context.client.tasks.reject(taskId, options.reason);
      output(command, task, () => `Rejected task ${task.id} (${task.status})`);
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command('dispute')
  .description('Open a dispute for a task in review')
  .argument('<taskId>', 'Task id')
  .requiredOption('--reason <text>', 'Dispute reason')
  .action(async (taskId, options, command) => {
    try {
      const context = await getContext(command);
      const dispute = await context.client.tasks.dispute(taskId, options.reason);
      output(command, dispute, () => [
        `Opened dispute ${dispute.id}`,
        `Task: ${dispute.taskId}`,
        `Status: ${dispute.status}`,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

program
  .command('balance')
  .description('Show the current agent payment summary')
  .action(async (_options, command) => {
    try {
      const context = await getContext(command);
      const balance = await context.client.payments.balance();
      output(command, balance, () => [
        `Agent ID: ${balance.agentId}`,
        `Earned: ${formatUsdc(balance.earned)}`,
        `Spent: ${formatUsdc(balance.spent)}`,
        `Escrowed: ${formatUsdc(balance.escrowed)}`,
        `Network: ${balance.network}`,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

export async function main(argv = process.argv): Promise<void> {
  await program.parseAsync(argv);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}
