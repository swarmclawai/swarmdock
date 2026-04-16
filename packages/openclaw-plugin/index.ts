/**
 * SwarmDock OpenClaw Plugin
 *
 * Gives OpenClaw agents native tools for interacting with the SwarmDock
 * P2P marketplace — register, discover tasks, bid, check status.
 */

import { SwarmDockClient, SkillTemplates } from '@swarmdock/sdk';
import type { SkillTemplate, RegisterParams, TaskListing } from '@swarmdock/sdk';
import nacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';

const { encodeBase64, decodeBase64 } = tweetnaclUtil;

interface PluginConfig {
  apiUrl?: string;
  walletAddress?: string;
  autoHeartbeat?: boolean;
}

interface PluginContext {
  config?: {
    plugins?: {
      entries?: Record<string, { config?: PluginConfig }>;
    };
  };
}

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  call: (args: Record<string, unknown>) => Promise<string> | string;
}

interface CommandHandlerCtx {
  args?: string;
}

interface CommandDefinition {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  handler: (ctx: CommandHandlerCtx) => { text: string } | Promise<{ text: string }>;
}

interface CliCommand {
  description(text: string): CliCommand;
  action(handler: () => Promise<void> | void): CliCommand;
  command(name: string): CliCommand;
}

interface CliProgram {
  command(name: string): CliCommand;
}

interface PluginApi {
  registerTool: (
    factory: (ctx: PluginContext) => ToolDefinition[],
    opts: { names: string[] },
  ) => void;
  registerService: (service: { id: string; start: () => void; stop: () => void }) => void;
  registerCli: (factory: (opts: { program: CliProgram }) => void, opts: { commands: string[] }) => void;
  registerCommand: (cmd: CommandDefinition) => void;
  logger: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
  };
}

// Module-level state
let cachedClient: SwarmDockClient | null = null;
let cachedPrivateKey: string | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function getConfig(ctx: PluginContext): PluginConfig {
  return ctx.config?.plugins?.entries?.swarmdock?.config ?? {};
}

function getOrCreatePrivateKey(): string {
  if (cachedPrivateKey) return cachedPrivateKey;

  // Generate a new keypair if none cached
  const keyPair = nacl.sign.keyPair();
  cachedPrivateKey = encodeBase64(keyPair.secretKey);
  return cachedPrivateKey;
}

function getClient(config: PluginConfig, privateKey?: string): SwarmDockClient {
  const key = privateKey ?? getOrCreatePrivateKey();
  if (cachedClient) return cachedClient;

  cachedClient = new SwarmDockClient({
    baseUrl: config.apiUrl ?? 'https://swarmdock-api.onrender.com',
    privateKey: key,
  });
  return cachedClient;
}

// Reserved for future tooling that needs to expose the public key.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getPublicKey(privateKeyBase64: string): string {
  const secretKey = decodeBase64(privateKeyBase64);
  const keyPair = nacl.sign.keyPair.fromSecretKey(secretKey);
  return encodeBase64(keyPair.publicKey);
}

type RegisterSkill = NonNullable<RegisterParams['skills']>[number];

function templateToSkill(t: SkillTemplate): RegisterSkill {
  return {
    skillId: t.skillId,
    skillName: t.skillName,
    description: t.description,
    category: t.category,
    tags: t.tags,
    pricingModel: t.pricingModel,
    basePrice: t.basePrice,
    examplePrompts: t.examplePrompts,
  };
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asSkillArray(value: unknown): RegisterSkill[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is RegisterSkill => {
    return (
      v !== null &&
      typeof v === 'object' &&
      typeof (v as RegisterSkill).skillId === 'string' &&
      typeof (v as RegisterSkill).skillName === 'string'
    );
  });
}

const swarmdockPlugin = {
  id: 'swarmdock',
  name: 'SwarmDock Marketplace',
  description: 'Native tools for the SwarmDock P2P agent marketplace — register, discover tasks, bid, and earn USDC',

  register(api: PluginApi) {
    // ── Agent Tools ──

    api.registerTool(
      (ctx) => {
        const config = getConfig(ctx);

        return [
          {
            name: 'swarmdock_quickstart',
            description: 'One-step setup: generates keys, picks skills from templates, registers on SwarmDock, and returns credentials. The fastest way to get an agent earning on SwarmDock.',
            parameters: {
              type: 'object',
              properties: {
                displayName: { type: 'string', description: 'Agent display name' },
                description: { type: 'string', description: 'Agent description' },
                walletAddress: { type: 'string', description: 'Base L2 wallet (0x...). Auto-provisioned if omitted.' },
                skillTemplates: {
                  type: 'array',
                  items: { type: 'string' },
                  description: `Skill template IDs to register with. Available: ${SkillTemplates.ids().join(', ')}`,
                },
              },
              required: ['displayName'],
            },
            async call(args) {
              const templateIds = asStringArray(args.skillTemplates).length > 0
                ? asStringArray(args.skillTemplates)
                : ['coding'];
              const skills = templateIds
                .map((id) => SkillTemplates.get(id))
                .filter((t): t is SkillTemplate => t !== undefined)
                .map(templateToSkill);

              const client = getClient(config);
              const result = await client.register({
                displayName: asString(args.displayName),
                description: asString(args.description) || undefined,
                framework: 'openclaw',
                walletAddress: asString(args.walletAddress) || config.walletAddress || '',
                skills,
              });

              return JSON.stringify({
                agentId: result.agent.id,
                did: result.agent.did,
                status: result.agent.status,
                trustLevel: result.agent.trustLevel,
                skills: templateIds,
                message: `Registered with ${skills.length} skills. Use swarmdock_tasks to find work.`,
              });
            },
          },
          {
            name: 'swarmdock_skill_templates',
            description: 'Browse available skill templates for SwarmDock registration. Returns pre-built skill definitions with pricing.',
            parameters: {
              type: 'object',
              properties: {
                search: { type: 'string', description: 'Optional search query to filter templates' },
              },
            },
            async call(args) {
              const search = asString(args.search);
              const results = search ? SkillTemplates.search(search) : SkillTemplates.list();
              return JSON.stringify(results.map((t: SkillTemplate) => ({
                id: t.skillId,
                name: t.skillName,
                description: t.description,
                category: t.category,
                price: `$${(Number(t.basePrice) / 1_000_000).toFixed(2)}/task`,
              })));
            },
          },
          {
            name: 'swarmdock_register',
            description: 'Register this agent on the SwarmDock P2P marketplace. Supports skill template IDs (e.g. "coding") or full skill objects. Use swarmdock_quickstart for a simpler one-step setup.',
            parameters: {
              type: 'object',
              properties: {
                displayName: { type: 'string', description: 'Agent display name' },
                description: { type: 'string', description: 'Agent description' },
                walletAddress: { type: 'string', description: 'Base L2 wallet (0x...)' },
                skillTemplates: {
                  type: 'array',
                  items: { type: 'string' },
                  description: `Skill template IDs. Available: ${SkillTemplates.ids().join(', ')}`,
                },
                skills: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      skillId: { type: 'string' },
                      skillName: { type: 'string' },
                      description: { type: 'string' },
                      category: { type: 'string' },
                      basePrice: { type: 'string', description: 'USDC in micro units (1000000 = $1)' },
                      examplePrompts: { type: 'array', items: { type: 'string' }, minItems: 5 },
                    },
                    required: ['skillId', 'skillName', 'description', 'category', 'basePrice', 'examplePrompts'],
                  },
                },
              },
              required: ['displayName'],
            },
            async call(args) {
              const templateSkills = asStringArray(args.skillTemplates)
                .map((id) => SkillTemplates.get(id))
                .filter((t): t is SkillTemplate => t !== undefined)
                .map(templateToSkill);

              const allSkills: RegisterSkill[] = [...templateSkills, ...asSkillArray(args.skills)];

              const client = getClient(config);
              const result = await client.register({
                displayName: asString(args.displayName),
                description: asString(args.description) || undefined,
                framework: 'openclaw',
                walletAddress: asString(args.walletAddress) || config.walletAddress || '0x0000000000000000000000000000000000000001',
                skills: allSkills,
              });
              return JSON.stringify({ agentId: result.agent.id, did: result.agent.did, status: result.agent.status, trustLevel: result.agent.trustLevel });
            },
          },
          {
            name: 'swarmdock_tasks',
            description: 'List open tasks on SwarmDock marketplace. Filter by status, skills, or budget.',
            parameters: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['open', 'bidding', 'assigned', 'in_progress', 'review', 'completed'], default: 'open' },
                skills: { type: 'string', description: 'Skill category filter' },
                limit: { type: 'number', default: 10 },
              },
            },
            async call(args) {
              const client = getClient(config);
              const result = await client.tasks.list({
                status: asString(args.status, 'open'),
                skills: typeof args.skills === 'string' ? args.skills : undefined,
                limit: String(asNumber(args.limit, 10)),
              });
              return JSON.stringify({
                total: result.total,
                tasks: result.tasks.map((t: TaskListing) => ({
                  id: t.id,
                  title: t.title,
                  budgetMax: t.budgetMax,
                  skills: t.skillRequirements,
                  status: t.status,
                })),
              });
            },
          },
          {
            name: 'swarmdock_bid',
            description: 'Submit a bid on a SwarmDock task. Requires prior registration.',
            parameters: {
              type: 'object',
              properties: {
                taskId: { type: 'string', description: 'Task UUID to bid on' },
                proposedPrice: { type: 'string', description: 'Bid amount in micro-USDC (1000000 = $1)' },
                confidenceScore: { type: 'number', description: 'Confidence 0-1', default: 0.8 },
                proposal: { type: 'string', description: 'Brief proposal text' },
              },
              required: ['taskId', 'proposedPrice'],
            },
            async call(args) {
              const client = getClient(config);
              await client.authenticate();
              const result = await client.tasks.bid(asString(args.taskId), {
                proposedPrice: asString(args.proposedPrice),
                confidenceScore: asNumber(args.confidenceScore, 0.8),
                proposal: typeof args.proposal === 'string' ? args.proposal : undefined,
              });
              return JSON.stringify(result);
            },
          },
          {
            name: 'swarmdock_status',
            description: 'Check your SwarmDock agent profile, balance, and reputation.',
            parameters: { type: 'object', properties: {} },
            async call() {
              const client = getClient(config);
              await client.authenticate();
              const [profile, balance] = await Promise.all([
                client.profile.get(),
                client.payments.balance().catch(() => null),
              ]);
              return JSON.stringify({
                displayName: profile.displayName,
                description: profile.description,
                did: profile.did,
                trustLevel: profile.trustLevel,
                status: profile.status,
                skillCount: profile.skills?.length ?? 0,
                balance: balance ?? 'unavailable',
              });
            },
          },
          {
            name: 'swarmdock_update_profile',
            description: 'Update your SwarmDock marketplace profile fields such as description, display name, framework, or model metadata.',
            parameters: {
              type: 'object',
              properties: {
                displayName: { type: 'string', description: 'New public display name' },
                description: { type: 'string', description: 'New public description' },
                framework: { type: 'string', description: 'Framework name' },
                frameworkVersion: { type: 'string', description: 'Framework version' },
                modelProvider: { type: 'string', description: 'Model provider name' },
                modelName: { type: 'string', description: 'Model name' },
                agentCardUrl: { type: 'string', description: 'External agent card URL' },
              },
            },
            async call(args) {
              const client = getClient(config);
              await client.authenticate();

              const candidate = {
                displayName: args.displayName,
                description: args.description,
                framework: args.framework,
                frameworkVersion: args.frameworkVersion,
                modelProvider: args.modelProvider,
                modelName: args.modelName,
                agentCardUrl: args.agentCardUrl,
              };
              const fields = Object.fromEntries(
                Object.entries(candidate).filter(([, value]) => typeof value === 'string'),
              ) as Record<string, string>;

              if (Object.keys(fields).length === 0) {
                throw new Error('At least one profile field is required.');
              }

              const result = await client.profile.update(fields);
              return JSON.stringify({
                id: result.id,
                displayName: result.displayName,
                description: result.description,
                framework: result.framework,
                frameworkVersion: result.frameworkVersion,
                modelProvider: result.modelProvider,
                modelName: result.modelName,
                agentCardUrl: result.agentCardUrl,
                updatedAt: result.updatedAt,
              });
            },
          },
          {
            name: 'swarmdock_update_skills',
            description: 'Update your skills on the SwarmDock marketplace.',
            parameters: {
              type: 'object',
              properties: {
                skills: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      skillId: { type: 'string' },
                      skillName: { type: 'string' },
                      description: { type: 'string' },
                      category: { type: 'string' },
                      basePrice: { type: 'string' },
                      examplePrompts: { type: 'array', items: { type: 'string' }, minItems: 5 },
                    },
                    required: ['skillId', 'skillName', 'description', 'category', 'basePrice', 'examplePrompts'],
                  },
                },
              },
              required: ['skills'],
            },
            async call(args) {
              const client = getClient(config);
              await client.authenticate();
              const result = await client.profile.updateSkills(asSkillArray(args.skills));
              return JSON.stringify(result);
            },
          },
        ];
      },
      { names: ['swarmdock_quickstart', 'swarmdock_skill_templates', 'swarmdock_register', 'swarmdock_tasks', 'swarmdock_bid', 'swarmdock_status', 'swarmdock_update_profile', 'swarmdock_update_skills'] },
    );

    // ── Auto-reply Command ──

    api.registerCommand({
      name: 'swarmdock',
      description: 'Show SwarmDock marketplace status',
      handler: () => ({
        text: `SwarmDock Plugin active. API: ${cachedClient ? 'connected' : 'not connected'}. Use swarmdock_status tool for full details.`,
      }),
    });

    // ── Background Heartbeat Service ──

    api.registerService({
      id: 'swarmdock-heartbeat',
      start: () => {
        heartbeatInterval = setInterval(async () => {
          if (!cachedClient) return;
          try {
            await cachedClient.heartbeat();
          } catch {
            // Silently skip if not authenticated yet
          }
        }, 60_000);
        api.logger.info('SwarmDock heartbeat service started');
      },
      stop: () => {
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
        api.logger.info('SwarmDock heartbeat service stopped');
      },
    });

    // ── CLI Command ──

    api.registerCli(
      ({ program }) => {
        const cmd = program.command('swarmdock').description('SwarmDock marketplace');

        cmd.command('status').description('Show agent status').action(async () => {
          if (!cachedClient) {
            console.log('Not connected. Register first via agent tool.');
            return;
          }
          try {
            await cachedClient.authenticate();
            const profile = await cachedClient.profile.get();
            console.log(`Agent: ${profile.displayName}`);
            console.log(`DID: ${profile.did}`);
            console.log(`Trust: L${profile.trustLevel}`);
            console.log(`Status: ${profile.status}`);
            console.log(`Skills: ${profile.skills?.length ?? 0}`);
          } catch (err) {
            console.error('Failed to get status:', err);
          }
        });
      },
      { commands: ['swarmdock'] },
    );
  },
};

export default swarmdockPlugin;
