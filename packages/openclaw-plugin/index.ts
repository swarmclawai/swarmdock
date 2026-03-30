/**
 * SwarmDock OpenClaw Plugin
 *
 * Gives OpenClaw agents native tools for interacting with the SwarmDock
 * P2P marketplace — register, discover tasks, bid, check status.
 */

import { SwarmDockClient } from '@swarmdock/sdk';
import nacl from 'tweetnacl';
import tweetnaclUtil from 'tweetnacl-util';

const { encodeBase64, decodeBase64 } = tweetnaclUtil;

interface PluginConfig {
  apiUrl?: string;
  walletAddress?: string;
  autoHeartbeat?: boolean;
}

interface PluginApi {
  registerTool: (factory: (ctx: any) => any, opts: { names: string[] }) => void;
  registerService: (service: { id: string; start: () => void; stop: () => void }) => void;
  registerCli: (factory: (opts: { program: any }) => void, opts: { commands: string[] }) => void;
  registerCommand: (cmd: { name: string; description: string; acceptsArgs?: boolean; handler: (ctx: any) => { text: string } | Promise<{ text: string }> }) => void;
  logger: { info: (...args: any[]) => void; error: (...args: any[]) => void; warn: (...args: any[]) => void };
}

// Module-level state
let cachedClient: SwarmDockClient | null = null;
let cachedPrivateKey: string | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

function getConfig(ctx: any): PluginConfig {
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

function getPublicKey(privateKeyBase64: string): string {
  const secretKey = decodeBase64(privateKeyBase64);
  const keyPair = nacl.sign.keyPair.fromSecretKey(secretKey);
  return encodeBase64(keyPair.publicKey);
}

const swarmdockPlugin = {
  id: 'swarmdock',
  name: 'SwarmDock Marketplace',
  description: 'Native tools for the SwarmDock P2P agent marketplace — register, discover tasks, bid, and earn USDC',

  register(api: PluginApi) {
    // ── Agent Tools ──

    api.registerTool(
      (ctx: any) => {
        const config = getConfig(ctx);

        return [
          {
            name: 'swarmdock_register',
            description: 'Register this agent on the SwarmDock P2P marketplace. Generates Ed25519 keypair, performs challenge-response auth, and returns agent profile with DID.',
            parameters: {
              type: 'object',
              properties: {
                displayName: { type: 'string', description: 'Agent display name' },
                description: { type: 'string', description: 'Agent description' },
                walletAddress: { type: 'string', description: 'Base L2 wallet (0x...)' },
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
            async call(args: any) {
              const client = getClient(config);
              const result = await client.register({
                displayName: args.displayName,
                description: args.description,
                framework: 'openclaw',
                walletAddress: args.walletAddress ?? config.walletAddress ?? '0x0000000000000000000000000000000000000001',
                skills: args.skills ?? [],
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
            async call(args: any) {
              const client = getClient(config);
              const result = await client.tasks.list({
                status: args.status ?? 'open',
                skills: args.skills,
                limit: String(args.limit ?? 10),
              });
              return JSON.stringify({ total: result.total, tasks: result.tasks.map((t: any) => ({ id: t.id, title: t.title, budgetMax: t.budgetMax, skills: t.skillRequirements, status: t.status })) });
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
            async call(args: any) {
              const client = getClient(config);
              await client.authenticate();
              const result = await client.tasks.bid(args.taskId, {
                proposedPrice: args.proposedPrice,
                confidenceScore: args.confidenceScore ?? 0.8,
                proposal: args.proposal,
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
                did: profile.did,
                trustLevel: profile.trustLevel,
                status: profile.status,
                skillCount: profile.skills?.length ?? 0,
                balance: balance ?? 'unavailable',
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
            async call(args: any) {
              const client = getClient(config);
              await client.authenticate();
              const result = await client.profile.updateSkills(args.skills);
              return JSON.stringify(result);
            },
          },
        ];
      },
      { names: ['swarmdock_register', 'swarmdock_tasks', 'swarmdock_bid', 'swarmdock_status', 'swarmdock_update_skills'] },
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
