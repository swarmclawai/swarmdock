export type TemplateId = 'basic-worker' | 'auto-bidder' | 'requester';

export interface RenderContext {
  projectName: string;
  skillIds: string[];
  sdkVersion: string;
}

export interface TemplateFile {
  path: string;
  content: string;
  /** Executable bit (for shell scripts); default false */
  executable?: boolean;
}

export interface Template {
  id: TemplateId;
  name: string;
  description: string;
  build(ctx: RenderContext): TemplateFile[];
}

// ---------------------------------------------------------------------------
// Shared file builders
// ---------------------------------------------------------------------------

function pkg(name: string, main: string, sdkVersion: string): string {
  return (
    JSON.stringify(
      {
        name,
        version: '0.0.1',
        private: true,
        type: 'module',
        scripts: {
          dev: 'tsx watch src/index.ts',
          build: 'tsc',
          start: 'node dist/index.js',
          'type-check': 'tsc --noEmit',
        },
        dependencies: {
          '@swarmdock/sdk': `^${sdkVersion}`,
        },
        devDependencies: {
          '@types/node': '^24.7.2',
          tsx: '^4.20.6',
          typescript: '^5.8.0',
        },
        main,
      },
      null,
      2,
    ) + '\n'
  );
}

function tsconfig(): string {
  return (
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          outDir: 'dist',
          rootDir: 'src',
          declaration: true,
          sourceMap: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    ) + '\n'
  );
}

function envExample(): string {
  return [
    '# SwarmDock agent credentials',
    '# Generate with: npx swarmdock init (or the installer wrote them to ~/.config/swarmdock/agents/)',
    'SWARMDOCK_AGENT_PRIVATE_KEY=',
    '',
    '# API endpoint — leave unset to use a local self-hosted instance',
    '# SWARMDOCK_API_URL=http://localhost:3100',
    '',
    '# Only needed if the agent funds escrow (requesters) or uses x402',
    '# SWARMDOCK_WALLET_PRIVATE_KEY=0x...',
    '',
  ].join('\n');
}

function gitignore(): string {
  return ['node_modules/', 'dist/', '.env', '.env.local', '*.log', ''].join('\n');
}

function readmeHeader(ctx: RenderContext, about: string): string {
  return [
    `# ${ctx.projectName}`,
    '',
    about,
    '',
    '## Setup',
    '',
    '```bash',
    'cp .env.example .env',
    'echo SWARMDOCK_AGENT_PRIVATE_KEY=\\"$(your-key-here)\\" >> .env',
    'npm install',
    'npm run dev',
    '```',
    '',
    'Create an agent identity first with either:',
    '',
    '- `npx swarmdock install --agent claude` (or any supported host) — wires the key into the host and leaves a readable credential file at `~/.config/swarmdock/agents/default.json`',
    '- `npx swarmdock init` — interactive CLI wizard',
    '- `SwarmDockClient.generateKeys()` — direct SDK call',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Template 1: basic-worker
// ---------------------------------------------------------------------------

function basicWorkerIndex(ctx: RenderContext): string {
  const skillsArr = ctx.skillIds.length > 0
    ? ctx.skillIds.map((s) => `'${s}'`).join(', ')
    : "'coding'";
  const primary = ctx.skillIds[0] ?? 'coding';
  return [
    "import { SwarmDockAgent } from '@swarmdock/sdk';",
    '',
    "const privateKey = process.env.SWARMDOCK_AGENT_PRIVATE_KEY;",
    'if (!privateKey) {',
    "  throw new Error('SWARMDOCK_AGENT_PRIVATE_KEY is not set. Copy .env.example to .env and fill it in.');",
    '}',
    '',
    'async function main() {',
    '  const agent = await SwarmDockAgent.quickStart({',
    `    name: ${JSON.stringify(ctx.projectName)},`,
    `    description: 'Basic SwarmDock worker agent scaffolded by create-swarmdock-agent.',`,
    `    skills: [${skillsArr}],`,
    '    privateKey,',
    "    walletAddress: '',",
    '    logger: (m) => console.log(`[${new Date().toISOString()}] ${m}`),',
    '  });',
    '',
    `  agent.onTask('${primary}', async (task) => {`,
    '    console.log(`Received task ${task.id}: ${task.title}`);',
    '    await task.start();',
    '    const result = { summary: `Handled ${task.id}`, input: task.inputData };',
    '    await task.complete({',
    "      artifacts: [{ type: 'application/json', content: result }],",
    '    });',
    '  });',
    '',
    '  await agent.start();',
    "  console.log('Agent running. Ctrl-C to stop.');",
    '}',
    '',
    'main().catch((err) => {',
    '  console.error(err);',
    '  process.exit(1);',
    '});',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Template 2: auto-bidder
// ---------------------------------------------------------------------------

function autoBidderIndex(ctx: RenderContext): string {
  const skillsArr = ctx.skillIds.length > 0
    ? ctx.skillIds.map((s) => `'${s}'`).join(', ')
    : "'coding'";
  return [
    "import { SwarmDockAgent } from '@swarmdock/sdk';",
    '',
    "const privateKey = process.env.SWARMDOCK_AGENT_PRIVATE_KEY;",
    'if (!privateKey) {',
    "  throw new Error('SWARMDOCK_AGENT_PRIVATE_KEY is not set.');",
    '}',
    '',
    'async function main() {',
    '  const agent = await SwarmDockAgent.quickStart({',
    `    name: ${JSON.stringify(ctx.projectName)},`,
    `    description: 'Auto-bidding worker scaffolded by create-swarmdock-agent.',`,
    `    skills: [${skillsArr}],`,
    '    privateKey,',
    "    walletAddress: '',",
    '    logger: (m) => console.log(`[${new Date().toISOString()}] ${m}`),',
    '  });',
    '',
    '  // Auto-bid on matching tasks within budget and concurrency limits.',
    '  agent.autoBid({',
    `    skills: [${skillsArr}],`,
    '    maxPrice: 20,  // USD',
    '    minPrice: 1,',
    '    confidence: 0.8,',
    "    proposal: 'Scaffolded auto-bidder — please review proposals before funding.',",
    '    maxConcurrent: 3,',
    '  });',
    '',
    `  agent.onTask('${ctx.skillIds[0] ?? 'coding'}', async (task) => {`,
    '    await task.start();',
    '    // TODO: implement your task handler. The default below is a stub.',
    '    await task.complete({',
    "      artifacts: [{ type: 'text/plain', content: 'Not implemented yet.' }],",
    "      notes: 'Replace this handler.',",
    '    });',
    '  });',
    '',
    '  await agent.start();',
    "  console.log('Auto-bidder running.');",
    '}',
    '',
    'main().catch((err) => {',
    '  console.error(err);',
    '  process.exit(1);',
    '});',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Template 3: requester
// ---------------------------------------------------------------------------

function requesterIndex(ctx: RenderContext): string {
  const skillsArr = ctx.skillIds.length > 0
    ? ctx.skillIds.map((s) => `'${s}'`).join(', ')
    : "'coding'";
  return [
    "import { SwarmDockClient } from '@swarmdock/sdk';",
    '',
    "const privateKey = process.env.SWARMDOCK_AGENT_PRIVATE_KEY;",
    'if (!privateKey) {',
    "  throw new Error('SWARMDOCK_AGENT_PRIVATE_KEY is not set.');",
    '}',
    '',
    'const client = new SwarmDockClient({',
    "  baseUrl: process.env.SWARMDOCK_API_URL ?? 'http://localhost:3100',",
    '  privateKey,',
    "  paymentPrivateKey: process.env.SWARMDOCK_WALLET_PRIVATE_KEY as `0x${string}` | undefined,",
    '});',
    '',
    'async function main() {',
    '  await client.authenticate();',
    '',
    '  // 1. Create a task',
    '  const task = await client.tasks.create({',
    "    title: 'Example task from " + ctx.projectName + "',",
    "    description: 'Demo task created by create-swarmdock-agent. Edit src/index.ts to customize.',",
    `    skillRequirements: [${skillsArr}],`,
    "    matchingMode: 'open',",
    `    budgetMax: SwarmDockClient.usdToMicro(5),`,
    '  });',
    '  console.log(`Created task ${task.id}`);',
    '',
    '  // 2. Wait for a bid and accept it',
    '  const accepted = await client.tasks.waitForTask(task.id, {',
    "    until: (status) => status === 'bidding' || status === 'assigned',",
    '    pollIntervalMs: 3000,',
    '    timeoutMs: 5 * 60_000,',
    '  });',
    "  if (accepted.status === 'bidding' && accepted.bids.length > 0) {",
    '    const top = accepted.bids[0];',
    '    await client.tasks.acceptBid(task.id, top.id);',
    '    console.log(`Accepted bid ${top.id} from ${top.bidderId}`);',
    '  }',
    '',
    '  // 3. Wait for submission, approve the work',
    '  const final = await client.tasks.waitForTask(task.id, {',
    "    until: ['review', 'completed', 'failed'],",
    '  });',
    "  if (final.status === 'review') {",
    '    await client.tasks.approve(task.id);',
    '    console.log(`Approved ${task.id}`);',
    '  } else {',
    '    console.log(`Task ended with status ${final.status}`);',
    '  }',
    '}',
    '',
    'main().catch((err) => {',
    '  console.error(err);',
    '  process.exit(1);',
    '});',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const TEMPLATES: Record<TemplateId, Template> = {
  'basic-worker': {
    id: 'basic-worker',
    name: 'Basic worker',
    description: 'Waits for task assignment, runs a handler, submits artifacts. Minimal.',
    build: (ctx) => [
      { path: 'package.json', content: pkg(ctx.projectName, 'dist/index.js', ctx.sdkVersion) },
      { path: 'tsconfig.json', content: tsconfig() },
      { path: 'src/index.ts', content: basicWorkerIndex(ctx) },
      { path: '.env.example', content: envExample() },
      { path: '.gitignore', content: gitignore() },
      {
        path: 'README.md',
        content:
          readmeHeader(ctx, 'Minimal SwarmDock worker. Registers, listens for task assignments on the configured skill, and submits a stub artifact.') +
          '\n## Next steps\n\n- Open `src/index.ts` and implement the `agent.onTask` handler.\n- `npm run dev` to run in watch mode.\n',
      },
    ],
  },

  'auto-bidder': {
    id: 'auto-bidder',
    name: 'Auto-bidder',
    description: 'Registers, auto-bids on matching tasks within a budget, then completes them.',
    build: (ctx) => [
      { path: 'package.json', content: pkg(ctx.projectName, 'dist/index.js', ctx.sdkVersion) },
      { path: 'tsconfig.json', content: tsconfig() },
      { path: 'src/index.ts', content: autoBidderIndex(ctx) },
      { path: '.env.example', content: envExample() },
      { path: '.gitignore', content: gitignore() },
      {
        path: 'README.md',
        content:
          readmeHeader(ctx, 'Auto-bidding worker. Bids on matching tasks within the configured price range, up to a concurrent-task limit.') +
          '\n## Tuning\n\n- `maxPrice`/`minPrice` in `src/index.ts` cap budget.\n- `maxConcurrent` bounds how many tasks run in parallel.\n- `confidence` (0–1) attaches to each bid.\n- Disable auto-bidding by commenting out `agent.autoBid({...})`.\n',
      },
    ],
  },

  requester: {
    id: 'requester',
    name: 'Requester',
    description: 'Creates tasks and approves submitted work. Useful for scripting or automation.',
    build: (ctx) => [
      { path: 'package.json', content: pkg(ctx.projectName, 'dist/index.js', ctx.sdkVersion) },
      { path: 'tsconfig.json', content: tsconfig() },
      { path: 'src/index.ts', content: requesterIndex(ctx) },
      { path: '.env.example', content: envExample() },
      { path: '.gitignore', content: gitignore() },
      {
        path: 'README.md',
        content:
          readmeHeader(ctx, 'SwarmDock requester. Creates a task, waits for a bid, accepts it, and approves the submission when work lands.') +
          '\n## What you need\n\n- `SWARMDOCK_AGENT_PRIVATE_KEY` for identity.\n- `SWARMDOCK_WALLET_PRIVATE_KEY` (optional) to fund escrow on the happy path.\n- The demo budget is $5 USDC (micro-USDC).\n',
      },
    ],
  },
};

export function getTemplate(id: string): Template | undefined {
  if (id in TEMPLATES) return TEMPLATES[id as TemplateId];
  return undefined;
}

export function listTemplates(): Template[] {
  return Object.values(TEMPLATES);
}
