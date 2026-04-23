#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { checkbox, input, select } from '@inquirer/prompts';
import { SkillTemplates } from '@swarmdock/shared';
import { scaffoldProject } from './scaffold.js';
import { listTemplates, type TemplateId } from './templates.js';

export const DEFAULT_SDK_VERSION = '0.6.1';

const program = new Command();

program
  .name('create-swarmdock-agent')
  .description('Scaffold a new SwarmDock agent project')
  .argument('[directory]', 'Project directory to create')
  .option('--template <id>', 'Template: basic-worker | auto-bidder | requester')
  .option('--skill <id>', 'Skill template ID (repeatable)', collectRepeat)
  .option('--sdk-version <version>', 'Pin the @swarmdock/sdk version', DEFAULT_SDK_VERSION)
  .option('--force', 'Allow writing into a non-empty directory')
  .action(async (directoryArg: string | undefined, options) => {
    try {
      const isInteractive = process.stdin.isTTY;

      // ---- Project directory ----
      const directory = directoryArg ?? (isInteractive
        ? await input({
            message: 'Project directory:',
            default: 'my-swarmdock-agent',
            validate: (v) => v.trim().length > 0 || 'Directory is required',
          })
        : 'my-swarmdock-agent');

      const targetDir = path.resolve(process.cwd(), directory);
      await ensureEmpty(targetDir, Boolean(options.force));

      const projectName = path.basename(targetDir);

      // ---- Template ----
      const templateId: TemplateId = options.template ?? (isInteractive
        ? (await select({
            message: 'Template:',
            choices: listTemplates().map((t) => ({
              name: `${t.name} — ${t.description}`,
              value: t.id,
            })),
          })) as TemplateId
        : 'basic-worker');

      if (!listTemplates().some((t) => t.id === templateId)) {
        throw new Error(`Unknown template "${templateId}"`);
      }

      // ---- Skills ----
      const flagSkills = normalizeArrayFlag(options.skill);
      let skillIds: string[] = flagSkills;
      if (skillIds.length === 0 && isInteractive) {
        const all = SkillTemplates.list();
        skillIds = await checkbox({
          message: 'Skills to register (space to toggle, enter to confirm):',
          choices: all.map((t) => ({
            name: `${t.skillName} — ${t.description.slice(0, 60)}... (${(Number(t.basePrice) / 1_000_000).toFixed(2)} USDC)`,
            value: t.skillId,
            checked: false,
          })),
          required: false,
        });
      }
      // Default to "coding" if caller skipped interactive + flags
      if (skillIds.length === 0) skillIds = ['coding'];

      // Validate
      for (const id of skillIds) {
        if (!SkillTemplates.get(id)) {
          const known = SkillTemplates.ids().join(', ');
          throw new Error(`Unknown skill "${id}". Known: ${known}`);
        }
      }

      // ---- Scaffold ----
      const sdkVersion = String(options.sdkVersion ?? DEFAULT_SDK_VERSION);
      const result = await scaffoldProject({
        templateId,
        projectName,
        targetDir,
        skillIds,
        sdkVersion,
      });

      // ---- Output ----
      console.log('');
      console.log(`Scaffolded ${templateId} at ${result.targetDir}`);
      console.log(`  ${result.writtenFiles.length} files written`);
      console.log('');
      console.log('Next steps:');
      console.log(`  cd ${path.relative(process.cwd(), result.targetDir) || '.'}`);
      console.log('  cp .env.example .env  # then fill in SWARMDOCK_AGENT_PRIVATE_KEY');
      console.log('  npm install');
      console.log('  npm run dev');
      console.log('');
      console.log('Need an identity? Any of:');
      console.log('  npx swarmdock install --agent claude   # wires into Claude Code + writes creds');
      console.log('  npx swarmdock init                     # interactive wizard');
      console.log('');
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

function collectRepeat(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function normalizeArrayFlag(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function ensureEmpty(targetDir: string, force: boolean): Promise<void> {
  if (!existsSync(targetDir)) {
    await mkdir(targetDir, { recursive: true });
    return;
  }
  const entries = await readdir(targetDir);
  const interesting = entries.filter((e) => e !== '.git' && !e.startsWith('.DS_Store'));
  if (interesting.length > 0 && !force) {
    throw new Error(
      `Target directory ${targetDir} is not empty. Pass --force to write into it anyway.`,
    );
  }
}

export { program };

export async function main(argv = process.argv): Promise<void> {
  await program.parseAsync(argv);
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  await main();
}
