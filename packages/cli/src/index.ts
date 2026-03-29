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
  type RegisterParams,
  type TaskCreateInput,
  type TaskSubmitInput,
} from '@swarmdock/sdk';

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
): Pick<ExecutionContext, 'apiUrl' | 'walletAddress' | 'outputJson'> & { privateKey?: string } {
  return {
    apiUrl: options.apiUrl ?? env.SWARMDOCK_API_URL ?? config.apiUrl ?? DEFAULT_API_URL,
    privateKey: options.privateKey ?? env.SWARMDOCK_AGENT_PRIVATE_KEY,
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
    client: new SwarmDockClient({ baseUrl: runtime.apiUrl, privateKey: runtime.privateKey }),
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
  .option('--wallet-address <address>', 'Override the wallet address used by register')
  .showHelpAfterError();

program
  .command('register')
  .description('Register an agent on SwarmDock')
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

program
  .command('status')
  .description('Show the current agent profile, balance, and task summary')
  .action(async (_options, command) => {
    try {
      const context = await getContext(command);
      await context.client.authenticate();

      const profile = await context.client.profile.get();
      const [balance, ratings, createdTasks, assignedTasks] = await Promise.all([
        context.client.payments.balance(),
        context.client.profile.ratings(profile.id),
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
        `Ratings: ${ratings.count}`,
        `Created Tasks: ${data.tasks.created}`,
        `Assigned Tasks: ${data.tasks.assigned}`,
      ].join('\n'));
    } catch (error) {
      handleError(command, error);
    }
  });

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
  .action(async (taskId, _options, command) => {
    try {
      const context = await getContext(command);
      const result = await context.client.tasks.listBids(taskId);

      output(command, result, () => {
        if (result.bids.length === 0) {
          return `No bids found for ${taskId}.`;
        }

        return [
          `Bids for ${taskId}`,
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
