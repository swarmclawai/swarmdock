import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { StoredArtifactRef, TaskSubmitInput } from '@swarmdock/shared';
import { sanitizeHtml } from '../lib/sanitize.js';

type StoredObject = {
  body: Buffer;
  contentType: string;
};

const DEFAULT_STORAGE_DIR = path.join(process.cwd(), '.swarmdock-artifacts');
const ARTIFACT_ROUTE_PREFIX = '/api/v1/artifacts/';

function artifactStorageRoot(): string {
  return path.resolve(process.env.ARTIFACT_STORAGE_DIR ?? DEFAULT_STORAGE_DIR);
}

function normalizeContentType(value: string | null | undefined): string {
  if (!value) {
    return 'application/octet-stream';
  }

  return value.split(';', 1)[0]?.trim() || 'application/octet-stream';
}

function extensionForContentType(contentType: string): string {
  switch (contentType) {
    case 'application/json':
      return '.json';
    case 'text/html':
      return '.html';
    case 'text/markdown':
      return '.md';
    case 'text/plain':
      return '.txt';
    default:
      return '';
  }
}

function buildArtifactUrl(key: string): string {
  const normalizedKey = normalizeArtifactKey(key);
  if (!normalizedKey) {
    throw new Error(`Invalid artifact key: ${key}`);
  }

  const encodedKey = normalizedKey.split('/').map(encodeURIComponent).join('/');
  const platformUrl = process.env.PLATFORM_URL?.replace(/\/+$/, '');
  return platformUrl ? `${platformUrl}${ARTIFACT_ROUTE_PREFIX}${encodedKey}` : `${ARTIFACT_ROUTE_PREFIX}${encodedKey}`;
}

export function normalizeArtifactKey(key: string | null | undefined): string | null {
  if (!key) {
    return null;
  }

  if (key.includes('\0') || key.includes('\\') || path.posix.isAbsolute(key)) {
    return null;
  }

  const normalized = path.posix.normalize(key);
  if (!normalized || normalized === '.' || normalized === '..') {
    return null;
  }

  if (normalized !== key || normalized.startsWith('../') || normalized.includes('/../')) {
    return null;
  }

  if (normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    return null;
  }

  return normalized;
}

export function trustedArtifactOrigins(): string[] {
  if (process.env.PLATFORM_URL?.trim()) {
    return [new URL(process.env.PLATFORM_URL).origin];
  }

  return [
    'http://localhost:3100',
    'http://127.0.0.1:3100',
  ];
}

export function artifactKeyFromTrustedUrl(url: string): string | null {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  if (!trustedArtifactOrigins().includes(parsedUrl.origin)) {
    return null;
  }

  if (!parsedUrl.pathname.startsWith(ARTIFACT_ROUTE_PREFIX)) {
    return null;
  }

  let key: string;
  try {
    key = decodeURIComponent(parsedUrl.pathname.slice(ARTIFACT_ROUTE_PREFIX.length));
  } catch {
    return null;
  }

  return normalizeArtifactKey(key);
}

function localArtifactPath(key: string): string | null {
  const normalizedKey = normalizeArtifactKey(key);
  if (!normalizedKey) {
    return null;
  }

  const root = artifactStorageRoot();
  const resolved = path.resolve(root, normalizedKey);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null;
  }

  return resolved;
}

function basenameFromUrl(url: string, fallback: string): string {
  try {
    const pathname = new URL(url).pathname;
    const candidate = path.basename(pathname);
    return candidate && candidate !== '/' ? candidate : fallback;
  } catch {
    return fallback;
  }
}

function storageClient(): S3Client | null {
  const endpoint = process.env.R2_ENDPOINT;
  const region = process.env.R2_REGION ?? 'auto';
  const bucket = process.env.R2_BUCKET;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  return new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
}

const s3 = storageClient();

async function writeStoredObject(key: string, body: Buffer, contentType: string): Promise<void> {
  const normalizedKey = normalizeArtifactKey(key);
  if (!normalizedKey) {
    throw new Error(`Invalid artifact key: ${key}`);
  }

  if (s3 && process.env.R2_BUCKET) {
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: normalizedKey,
      Body: body,
      ContentType: contentType,
    }));
    return;
  }

  const filePath = localArtifactPath(normalizedKey);
  if (!filePath) {
    throw new Error(`Invalid artifact key: ${key}`);
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, body);
}

async function readReadableBody(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function readStoredArtifact(key: string): Promise<StoredObject | null> {
  const normalizedKey = normalizeArtifactKey(key);
  if (!normalizedKey) {
    return null;
  }

  if (s3 && process.env.R2_BUCKET) {
    const response = await s3.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: normalizedKey,
    })).catch(() => null);

    if (!response?.Body) {
      return null;
    }

    const body = response.Body instanceof Readable
      ? await readReadableBody(response.Body)
      : Buffer.from(await response.Body.transformToByteArray());

    return {
      body,
      contentType: normalizeContentType(response.ContentType),
    };
  }

  const filePath = localArtifactPath(normalizedKey);
  if (!filePath) {
    return null;
  }
  const body = await readFile(filePath).catch(() => null);
  if (!body) {
    return null;
  }

  return {
    body,
    contentType: normalizeContentType(path.extname(filePath) === '.json' ? 'application/json' : 'application/octet-stream'),
  };
}

async function storeBuffer(params: {
  key: string;
  body: Buffer;
  contentType: string;
  source: 'inline' | 'file';
  originalUrl?: string;
}): Promise<StoredArtifactRef> {
  const normalizedKey = normalizeArtifactKey(params.key);
  if (!normalizedKey) {
    throw new Error(`Invalid artifact key: ${params.key}`);
  }

  await writeStoredObject(normalizedKey, params.body, params.contentType);

  return {
    key: normalizedKey,
    url: buildArtifactUrl(normalizedKey),
    contentType: params.contentType,
    byteLength: params.body.byteLength,
    source: params.source,
    ...(params.originalUrl ? { originalUrl: params.originalUrl } : {}),
  };
}

export async function persistTaskSubmission(taskId: string, submission: TaskSubmitInput): Promise<{
  artifacts: Array<Record<string, unknown>>;
  files: string[];
  storedFiles: StoredArtifactRef[];
}> {
  const artifacts = await Promise.all(
    submission.artifacts.map(async (artifact, index) => {
      const contentType = normalizeContentType(artifact.type);
      // Sanitize HTML artifacts before storage
      let content = artifact.content;
      if (contentType === 'text/html' && typeof content === 'string') {
        content = sanitizeHtml(content);
      }
      const serialized = typeof content === 'string'
        ? Buffer.from(content, 'utf8')
        : Buffer.from(JSON.stringify(content, null, 2), 'utf8');
      const extension = extensionForContentType(contentType);
      const key = `tasks/${taskId}/artifacts/${String(index + 1).padStart(2, '0')}-${crypto.randomUUID()}${extension}`;
      const storage = await storeBuffer({
        key,
        body: serialized,
        contentType,
        source: 'inline',
      });

      return {
        ...artifact,
        storage,
      };
    }),
  );

  const storedFiles = await Promise.all(
    submission.files.map(async (url, index) => {
      const sourceKey = artifactKeyFromTrustedUrl(url);
      if (!sourceKey) {
        throw new Error('Submission files must reference trusted SwarmDock artifact URLs');
      }

      const sourceArtifact = await readStoredArtifact(sourceKey);
      if (!sourceArtifact) {
        throw new Error(`Referenced submission file not found: ${url}`);
      }

      const body = sourceArtifact.body;
      const contentType = sourceArtifact.contentType;
      const baseName = basenameFromUrl(url, `file-${index + 1}`);
      const extension = path.extname(baseName) || extensionForContentType(contentType);
      const key = `tasks/${taskId}/files/${String(index + 1).padStart(2, '0')}-${crypto.randomUUID()}${extension}`;

      return storeBuffer({
        key,
        body,
        contentType,
        source: 'file',
        originalUrl: url,
      });
    }),
  );

  return {
    artifacts,
    files: storedFiles.map((file) => file.url),
    storedFiles,
  };
}
