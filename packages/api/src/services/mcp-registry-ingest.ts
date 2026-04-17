/**
 * MCP registry ingestion. Polls upstream directories on a schedule and
 * upserts into our normalized schema. Each adapter is independently crawlable
 * so a single upstream outage doesn't block the others.
 *
 * The worker entry point (runMcpIngestionBatch) is invoked from
 * packages/api/src/worker.ts under the existing `timedWorker` + advisory-lock
 * pattern so multiple worker replicas never double-ingest.
 */
import { createLogger } from '../lib/logger.js';
import { upsertIngestedServer } from './mcp-registry.js';
import { MCP_REGISTRY_SOURCE, MCP_TRANSPORT, MCP_AUTH_MODE, MCP_INSTALL_METHOD } from '@swarmdock/shared';

const log = createLogger({ service: 'mcp-ingest' });

export interface UpstreamServer {
  slug: string;
  name: string;
  description: string;
  homepage?: string;
  repoUrl?: string;
  license?: string;
  transport: string;
  authMode: string;
  language?: string;
  categories?: string[];
  tags?: string[];
  upstreamId: string;
  installations?: Array<{ method: string; spec: Record<string, unknown> }>;
  tools?: Array<{ name: string; description?: string; inputSchema?: unknown }>;
}

export interface RegistryAdapter {
  source: string;
  fetch(): Promise<UpstreamServer[]>;
}

/**
 * GitHub-hosted modelcontextprotocol/servers — the canonical "reference"
 * servers list. The README lists one server per bullet; we use the GitHub
 * contents API to enumerate /src and infer server metadata from each
 * subdirectory's package.json.
 *
 * No auth required for public rate limit (60 req/hr per IP) but a token
 * bumps that to 5000 when MCP_GITHUB_TOKEN is set.
 */
export const mcpOfficialAdapter: RegistryAdapter = {
  source: MCP_REGISTRY_SOURCE.MCP_OFFICIAL,
  async fetch(): Promise<UpstreamServer[]> {
    const token = process.env.MCP_GITHUB_TOKEN;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'swarmdock-mcp-registry-ingest',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const listRes = await fetch('https://api.github.com/repos/modelcontextprotocol/servers/contents/src', { headers });
    if (!listRes.ok) {
      throw new Error(`modelcontextprotocol/servers listing failed: ${listRes.status}`);
    }
    const entries = (await listRes.json()) as Array<{ name: string; path: string; type: string }>;
    const servers: UpstreamServer[] = [];

    for (const entry of entries) {
      if (entry.type !== 'dir') continue;
      try {
        const pkgRes = await fetch(
          `https://api.github.com/repos/modelcontextprotocol/servers/contents/${entry.path}/package.json`,
          { headers },
        );
        if (!pkgRes.ok) continue;
        const pkgFile = (await pkgRes.json()) as { content?: string; encoding?: string };
        if (!pkgFile.content) continue;
        const raw = pkgFile.encoding === 'base64'
          ? Buffer.from(pkgFile.content, 'base64').toString('utf8')
          : pkgFile.content;
        const pkg = JSON.parse(raw) as {
          name?: string;
          description?: string;
          license?: string;
          homepage?: string;
          repository?: string | { url: string };
          bin?: Record<string, string>;
        };

        const pkgName = pkg.name ?? `mcp-${entry.name}`;
        const slug = slugify(pkgName);
        const description = pkg.description ?? `Reference MCP server: ${entry.name}`;
        const repoUrl = typeof pkg.repository === 'string'
          ? pkg.repository
          : pkg.repository?.url ?? `https://github.com/modelcontextprotocol/servers/tree/main/${entry.path}`;

        const installations: UpstreamServer['installations'] = [];
        if (pkg.bin) {
          installations.push({
            method: MCP_INSTALL_METHOD.NPX,
            spec: { command: 'npx', args: ['-y', pkgName] },
          });
          installations.push({
            method: MCP_INSTALL_METHOD.NPM,
            spec: { package: pkgName },
          });
        }

        servers.push({
          slug,
          name: pkgName,
          description,
          homepage: pkg.homepage,
          repoUrl,
          license: pkg.license,
          transport: MCP_TRANSPORT.STDIO,
          authMode: MCP_AUTH_MODE.NONE,
          language: 'typescript',
          categories: ['reference'],
          tags: [entry.name],
          upstreamId: entry.path,
          installations,
        });
      } catch (err) {
        log.warn(`failed to ingest ${entry.path}: ${String(err)}`);
      }
    }

    return servers;
  },
};

/**
 * Smithery adapter. Smithery exposes /api/v1/registry/servers which returns
 * a paginated JSON list of servers with transport, tools, and install specs.
 *
 * Rate limit is generous (60/min per IP); token optional via SMITHERY_API_KEY.
 */
export const smitheryAdapter: RegistryAdapter = {
  source: MCP_REGISTRY_SOURCE.SMITHERY,
  async fetch(): Promise<UpstreamServer[]> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'User-Agent': 'swarmdock-mcp-registry-ingest',
    };
    if (process.env.SMITHERY_API_KEY) {
      headers.Authorization = `Bearer ${process.env.SMITHERY_API_KEY}`;
    }

    const servers: UpstreamServer[] = [];
    let page = 1;
    const maxPages = Number(process.env.SMITHERY_MAX_PAGES ?? '5');

    while (page <= maxPages) {
      const res = await fetch(`https://registry.smithery.ai/servers?page=${page}&pageSize=50`, { headers });
      if (!res.ok) {
        if (page === 1) throw new Error(`smithery fetch failed: ${res.status}`);
        break;
      }
      const body = (await res.json()) as {
        servers?: Array<{
          qualifiedName: string;
          displayName?: string;
          description?: string;
          homepage?: string;
          iconUrl?: string;
          tags?: string[];
          remote?: boolean;
          connections?: Array<{ type: string; config?: unknown }>;
        }>;
        pagination?: { totalPages?: number };
      };
      if (!body.servers || body.servers.length === 0) break;

      for (const s of body.servers) {
        const connections = s.connections ?? [];
        const preferred = connections.find((c) => c.type === 'stdio') ?? connections[0];
        const transport = mapSmitheryTransport(preferred?.type);

        servers.push({
          slug: slugify(s.qualifiedName),
          name: s.displayName ?? s.qualifiedName,
          description: s.description ?? 'No description provided.',
          homepage: s.homepage,
          repoUrl: s.homepage,
          transport,
          authMode: MCP_AUTH_MODE.NONE,
          categories: s.tags?.slice(0, 3) ?? [],
          tags: s.tags ?? [],
          upstreamId: s.qualifiedName,
          installations: connections.map((c) => ({
            method: c.type === 'stdio' ? MCP_INSTALL_METHOD.NPX : MCP_INSTALL_METHOD.REMOTE,
            spec: (c.config as Record<string, unknown>) ?? {},
          })),
        });
      }

      if (body.pagination?.totalPages && page >= body.pagination.totalPages) break;
      page += 1;
    }

    return servers;
  },
};

function mapSmitheryTransport(type?: string): string {
  switch (type) {
    case 'stdio': return MCP_TRANSPORT.STDIO;
    case 'sse': return MCP_TRANSPORT.SSE;
    case 'http':
    case 'streamable_http': return MCP_TRANSPORT.HTTP;
    case 'ws':
    case 'websocket': return MCP_TRANSPORT.WEBSOCKET;
    default: return MCP_TRANSPORT.STDIO;
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 80);
}

const ADAPTERS: RegistryAdapter[] = [mcpOfficialAdapter, smitheryAdapter];

export interface IngestionResult {
  source: string;
  fetched: number;
  created: number;
  updated: number;
  errors: number;
}

/**
 * Run a single ingestion pass across all configured adapters. Safe to call
 * from the worker on a cron. Per-adapter errors don't abort siblings.
 */
export async function runMcpIngestionBatch(
  sources: string[] = ADAPTERS.map((a) => a.source),
): Promise<IngestionResult[]> {
  const results: IngestionResult[] = [];
  const selected = ADAPTERS.filter((a) => sources.includes(a.source));

  for (const adapter of selected) {
    const result: IngestionResult = {
      source: adapter.source,
      fetched: 0, created: 0, updated: 0, errors: 0,
    };

    try {
      const upstreamServers = await adapter.fetch();
      result.fetched = upstreamServers.length;
      log.info(`ingested ${upstreamServers.length} from ${adapter.source}`);

      for (const upstream of upstreamServers) {
        try {
          const { created } = await upsertIngestedServer(adapter.source, upstream);
          if (created) result.created += 1;
          else result.updated += 1;
        } catch (err) {
          result.errors += 1;
          log.warn(`upsert failed for ${upstream.slug}: ${String(err)}`);
        }
      }
    } catch (err) {
      log.error(`adapter ${adapter.source} failed: ${String(err)}`);
      result.errors += 1;
    }

    results.push(result);
  }

  return results;
}
