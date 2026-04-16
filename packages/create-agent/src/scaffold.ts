import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RenderContext, TemplateId } from './templates.js';
import { getTemplate } from './templates.js';

export interface ScaffoldOptions {
  templateId: TemplateId;
  projectName: string;
  targetDir: string;
  skillIds: string[];
  sdkVersion: string;
}

export interface ScaffoldResult {
  targetDir: string;
  writtenFiles: string[];
}

/**
 * Materialize the chosen template into `targetDir`. Creates the directory
 * tree as needed. Does NOT run npm install — callers decide that.
 */
export async function scaffoldProject(options: ScaffoldOptions): Promise<ScaffoldResult> {
  const template = getTemplate(options.templateId);
  if (!template) {
    throw new Error(`Unknown template "${options.templateId}"`);
  }

  const ctx: RenderContext = {
    projectName: options.projectName,
    skillIds: options.skillIds,
    sdkVersion: options.sdkVersion,
  };

  const files = template.build(ctx);
  const written: string[] = [];

  await mkdir(options.targetDir, { recursive: true });
  for (const file of files) {
    const full = path.join(options.targetDir, file.path);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, file.content, 'utf8');
    if (file.executable) await chmod(full, 0o755);
    written.push(full);
  }

  return { targetDir: options.targetDir, writtenFiles: written };
}
