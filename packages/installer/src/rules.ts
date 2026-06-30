import type { AgentHost, RuleRenderContext } from './types.js';

/**
 * Canonical SwarmDock rules every host gets embedded into its instructions file.
 * Ordered from most critical (credentials) to least (dispute hygiene).
 */
export const SWARMDOCK_RULE_BULLETS: readonly string[] = [
  'Your SwarmDock agent identity is an Ed25519 keypair. The base64 secret lives in the env var `SWARMDOCK_AGENT_PRIVATE_KEY`. Never print, log, paste, or commit the secret value.',
  'SwarmDock is an open-source, self-hosted peer-to-peer marketplace (https://github.com/swarmclawai/swarmdock). The API base comes from `SWARMDOCK_API_URL` and defaults to http://localhost:3100 for local self-hosting.',
  'For every paid task, follow the lifecycle: discover → bid → await acceptance → start → submit → earn. Do not skip `start` and never submit without artifacts.',
  'Prefer the `swarmdock_*` MCP tools when available; they route through your self-hosted MCP endpoint at `${SWARMDOCK_API_URL}/mcp` (default http://localhost:3100/mcp) with the agent\'s bearer key. Fall back to the `swarmdock` CLI or `@swarmdock/sdk` only when an MCP tool does not exist.',
  'Before bidding, inspect `budgetMax`, `matchingMode`, `skillRequirements`, and the existing bid count. Only bid when the task matches your registered skills.',
  'Bid prices are in micro-USDC strings (6 decimals). Use `SwarmDockClient.usdToMicro()` or pass strings like `5000000` for $5.',
  'On assignment you receive a `task.assigned` SSE event with your `assigneeId`. Call `swarmdock_task_start`, do the work, then `swarmdock_task_submit` with `{ artifacts, files?, notes? }`.',
  'Never enable auto-bidding or long-running agent loops without explicit user approval.',
  'For earnings, reputation, or portfolio queries, use `swarmdock_payments_balance`, `swarmdock_profile_reputation`, or `swarmdock_profile_portfolio` rather than the raw API.',
  'For disputes, use `swarmdock_task_dispute` with a clear reason. Resolution goes to a 3-judge tribunal of high-reputation agents.',
];

const MANAGED_START = '<!-- swarmdock:managed:start -->';
const MANAGED_END = '<!-- swarmdock:managed:end -->';

function bulletsBlock(bullets: readonly string[]): string {
  return bullets.map((b) => `- ${b}`).join('\n');
}

export function buildManagedBody(ctx: RuleRenderContext): string {
  return [
    '## SwarmDock (managed by the installer — do not edit between the markers)',
    '',
    `Identity: \`${ctx.did}\` (\`${ctx.agentName}\`)`,
    `API base: \`${ctx.apiUrl}\``,
    `Credentials: \`${ctx.credentialsPath}\` (env: \`${ctx.envVarName}\`)`,
    '',
    '### Marketplace workflow',
    '',
    bulletsBlock(SWARMDOCK_RULE_BULLETS),
    '',
    '### Useful commands',
    '',
    '```',
    'swarmdock status',
    'swarmdock tasks list',
    'swarmdock tasks watch',
    'swarmdock balance',
    '```',
  ].join('\n');
}

/**
 * Upsert a <!-- swarmdock:managed:start --> block inside existing content.
 * If the block doesn't exist, appends it with a trailing newline.
 */
export function upsertManagedBlock(existingContent: string, body: string): string {
  const block = `${MANAGED_START}\n${body.trim()}\n${MANAGED_END}`;
  const startIdx = existingContent.indexOf(MANAGED_START);
  const endIdx = existingContent.indexOf(MANAGED_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = existingContent.slice(0, startIdx).trimEnd();
    const after = existingContent.slice(endIdx + MANAGED_END.length).replace(/^\s*/, '');
    const leading = before.length === 0 ? '' : before + '\n\n';
    const trailing = after.length === 0 ? '\n' : '\n\n' + after;
    return leading + block + trailing;
  }

  const separator = existingContent.length === 0 || existingContent.endsWith('\n\n')
    ? ''
    : existingContent.endsWith('\n')
      ? '\n'
      : '\n\n';
  return existingContent + separator + block + '\n';
}

export function removeManagedBlock(existingContent: string): string {
  const startIdx = existingContent.indexOf(MANAGED_START);
  const endIdx = existingContent.indexOf(MANAGED_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return existingContent;
  const before = existingContent.slice(0, startIdx).replace(/\n{2,}$/, '\n');
  const after = existingContent.slice(endIdx + MANAGED_END.length).replace(/^\n+/, '');
  if (before.length === 0) return after;
  if (after.length === 0) return before.endsWith('\n') ? before : before + '\n';
  return before.trimEnd() + '\n\n' + after;
}

export function hasManagedBlock(existingContent: string): boolean {
  return existingContent.includes(MANAGED_START) && existingContent.includes(MANAGED_END);
}

// ------------------------------------------------------------------
// Standalone file templates
// ------------------------------------------------------------------

const SWARMDOCK_FRONTMATTER_MARKER = 'name: swarmdock';

export function hasSwarmdockFrontmatter(content: string): boolean {
  const head = content.slice(0, 400);
  return head.includes(SWARMDOCK_FRONTMATTER_MARKER);
}

export function buildSkillFile(ctx: RuleRenderContext): string {
  return [
    '---',
    'name: swarmdock',
    'description: SwarmDock marketplace integration. Register, discover tasks, bid, submit work, and earn USDC.',
    'tags: [marketplace, tasks, payments, agents]',
    'managedBy: swarmdock-installer',
    `agent: ${ctx.agentName}`,
    `did: ${ctx.did}`,
    '---',
    '',
    '# SwarmDock',
    '',
    `Agent: \`${ctx.agentName}\` (\`${ctx.did}\`)`,
    `API base: \`${ctx.apiUrl}\``,
    `Credentials file: \`${ctx.credentialsPath}\` (env \`${ctx.envVarName}\`)`,
    '',
    '## Marketplace rules',
    '',
    bulletsBlock(SWARMDOCK_RULE_BULLETS),
    '',
    '## How to call SwarmDock',
    '',
    'Use the hosted MCP endpoint when possible:',
    '',
    '```',
    'POST https://www.swarmdock.ai/mcp',
    `Authorization: Bearer $${ctx.envVarName}`,
    '```',
    '',
    'Or the CLI:',
    '',
    '```',
    'swarmdock tasks list',
    'swarmdock tasks watch',
    'swarmdock bid <taskId> --price 5',
    'swarmdock submit <taskId> --file ./submission.json',
    '```',
    '',
    'Or the SDK:',
    '',
    '```typescript',
    "import { SwarmDockClient } from '@swarmdock/sdk';",
    'const client = new SwarmDockClient({',
    `  baseUrl: '${ctx.apiUrl}',`,
    `  privateKey: process.env.${ctx.envVarName},`,
    '});',
    '```',
    '',
    '## Task lifecycle',
    '',
    '1. `swarmdock_task_list` / `task.created` SSE event — discover open work',
    '2. `swarmdock_task_bid` — submit a bid at or below `budgetMax`',
    '3. (requester accepts → escrow funds → `task.assigned` SSE event fires)',
    '4. `swarmdock_task_start` — mark in progress',
    '5. `swarmdock_task_submit` — ship artifacts + files',
    '6. (requester approves or disputes → escrow releases)',
  ].join('\n');
}

export function buildCursorRule(ctx: RuleRenderContext): string {
  return [
    '---',
    'name: swarmdock',
    'description: SwarmDock marketplace guardrails and workflow.',
    'alwaysApply: true',
    'managedBy: swarmdock-installer',
    '---',
    '',
    `Identity \`${ctx.did}\` (\`${ctx.agentName}\`). API \`${ctx.apiUrl}\`. Credentials in \`${ctx.credentialsPath}\` (env \`${ctx.envVarName}\`).`,
    '',
    bulletsBlock(SWARMDOCK_RULE_BULLETS),
  ].join('\n');
}

export function buildVscodeChatmode(ctx: RuleRenderContext): string {
  return [
    '---',
    'name: swarmdock',
    'description: SwarmDock marketplace agent mode.',
    "tools: ['swarmdock']",
    'managedBy: swarmdock-installer',
    '---',
    '',
    '# SwarmDock Agent',
    '',
    `Acting as SwarmDock agent \`${ctx.agentName}\` (\`${ctx.did}\`) against \`${ctx.apiUrl}\`.`,
    '',
    bulletsBlock(SWARMDOCK_RULE_BULLETS),
  ].join('\n');
}

export function buildAntigravityRule(ctx: RuleRenderContext): string {
  return [
    '---',
    'name: swarmdock',
    'description: SwarmDock marketplace rules.',
    'managedBy: swarmdock-installer',
    '---',
    '',
    `Agent \`${ctx.agentName}\` (\`${ctx.did}\`). API \`${ctx.apiUrl}\`. Key env \`${ctx.envVarName}\`.`,
    '',
    bulletsBlock(SWARMDOCK_RULE_BULLETS),
  ].join('\n');
}

export function buildAntigravityWorkflow(ctx: RuleRenderContext): string {
  return [
    '---',
    'name: swarmdock-watch',
    'description: Watch SwarmDock for matching tasks and surface them for user review.',
    'managedBy: swarmdock-installer',
    '---',
    '',
    `Run \`swarmdock tasks watch\` with credentials from \`${ctx.credentialsPath}\`. Present each matching task to the user before bidding.`,
  ].join('\n');
}

export function buildKiroSteering(ctx: RuleRenderContext): string {
  return [
    '---',
    'name: swarmdock',
    'description: SwarmDock marketplace steering rules.',
    'inclusion: always',
    'managedBy: swarmdock-installer',
    '---',
    '',
    `SwarmDock agent \`${ctx.agentName}\` (\`${ctx.did}\`). API \`${ctx.apiUrl}\`. Bearer env \`${ctx.envVarName}\`.`,
    '',
    bulletsBlock(SWARMDOCK_RULE_BULLETS),
  ].join('\n');
}

export function buildAiderConventions(ctx: RuleRenderContext): string {
  return [
    '# Conventions (swarmdock-managed)',
    '',
    `SwarmDock agent \`${ctx.agentName}\` (\`${ctx.did}\`).`,
    `API \`${ctx.apiUrl}\`. Bearer env \`${ctx.envVarName}\`.`,
    '',
    bulletsBlock(SWARMDOCK_RULE_BULLETS),
    '',
    'SwarmDock has no native MCP client in aider. Use the CLI (`swarmdock tasks list`) or the SDK (`@swarmdock/sdk`) when the user asks for marketplace actions.',
  ].join('\n') + '\n';
}

// ------------------------------------------------------------------
// Hook script — minimal session-start announce
// ------------------------------------------------------------------

export function buildHookScript(host: AgentHost, ctx: RuleRenderContext): string {
  return [
    '#!/usr/bin/env node',
    `// SwarmDock ${host} hook — prints agent identity on session start.`,
    '// Managed by the swarmdock installer; safe to delete.',
    'const id = process.env.SWARMDOCK_AGENT_PRIVATE_KEY ? "configured" : "missing";',
    `console.log(JSON.stringify({ agent: "${ctx.agentName}", did: "${ctx.did}", apiUrl: "${ctx.apiUrl}", secret: id }));`,
    '',
  ].join('\n');
}
