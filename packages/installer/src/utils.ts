import { mkdir, readFile, writeFile, chmod, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export function expandHome(p: string): string {
  if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

export function resolveRepoPath(repoDir: string, rel: string): string {
  const expanded = expandHome(rel);
  if (path.isAbsolute(expanded)) return expanded;
  return path.resolve(repoDir, expanded);
}

export async function fileExists(filePath: string): Promise<boolean> {
  if (!existsSync(filePath)) return false;
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readFileSafe(filePath: string): Promise<string | null> {
  if (!(await fileExists(filePath))) return null;
  return readFile(filePath, 'utf8');
}

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function writeFileMode(
  filePath: string,
  content: string,
  mode?: number,
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, 'utf8');
  if (mode !== undefined) {
    await chmod(filePath, mode);
  }
}

/**
 * Append a path to .gitignore if not already present. Idempotent.
 * Returns true if the .gitignore file was mutated.
 */
export async function appendToGitignore(
  repoDir: string,
  relativePath: string,
): Promise<boolean> {
  const gitignorePath = path.join(repoDir, '.gitignore');
  const entry = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  const existing = (await readFileSafe(gitignorePath)) ?? '';
  const lines = existing.split('\n').map((line) => line.trim());
  if (lines.includes(entry) || lines.includes(relativePath)) return false;

  const trailer = existing.length === 0 || existing.endsWith('\n') ? '' : '\n';
  const block = existing.length === 0
    ? `# SwarmDock installer\n${entry}\n`
    : `${trailer}\n# SwarmDock installer\n${entry}\n`;
  await writeFile(gitignorePath, existing + block, 'utf8');
  return true;
}

/**
 * Human-readable relative path for console output.
 */
export function displayPath(filePath: string): string {
  const home = homedir();
  if (filePath.startsWith(home)) return `~${filePath.slice(home.length)}`;
  const cwd = process.cwd();
  if (filePath.startsWith(cwd)) {
    const rel = filePath.slice(cwd.length);
    return rel.startsWith('/') ? `.${rel}` : `./${rel}`;
  }
  return filePath;
}
