/**
 * Hosted MCP endpoint at POST /mcp.
 *
 * Bearer auth accepts an Agent Authorization Token (AAT) and the legacy
 * Ed25519 private-key flow. Operators can disable legacy private-key bearer
 * auth by setting SWARMDOCK_MCP_ALLOW_PRIVATE_KEY_AUTH=0.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Http2ServerRequest, Http2ServerResponse } from 'node:http2';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'swarmdock-mcp';
import tweetnaclUtil from 'tweetnacl-util';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ service: 'mcp-http' });

const ED25519_SECRET_BYTES = 64;

type McpBearerAuth =
  | { kind: 'aat'; token: string; agentId: string }
  | { kind: 'private_key'; privateKey: string };

function extractBearer(req: IncomingMessage | Http2ServerRequest): string | undefined {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return undefined;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function isValidEd25519Secret(base64: string): boolean {
  try {
    const bytes = tweetnaclUtil.decodeBase64(base64);
    return bytes.length === ED25519_SECRET_BYTES;
  } catch {
    return false;
  }
}

export function isLegacyPrivateKeyAuthAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.SWARMDOCK_MCP_ALLOW_PRIVATE_KEY_AUTH === '0') {
    return false;
  }
  return true;
}

function decodeBase64UrlJson(segment: string): unknown {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

export function extractAgentIdFromAat(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }

  try {
    const payload = decodeBase64UrlJson(parts[1]);
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const agentId = (payload as { agent_id?: unknown }).agent_id;
    if (typeof agentId === 'string' && agentId.length > 0) {
      return agentId;
    }

    const subject = (payload as { sub?: unknown }).sub;
    const didPrefix = 'did:web:swarmdock.ai:agents:';
    if (typeof subject === 'string' && subject.startsWith(didPrefix)) {
      return subject.slice(didPrefix.length) || null;
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveMcpBearerAuth(
  bearer: string,
  env: NodeJS.ProcessEnv = process.env,
): McpBearerAuth | null {
  const agentId = extractAgentIdFromAat(bearer);
  if (agentId) {
    return { kind: 'aat', token: bearer, agentId };
  }

  if (isValidEd25519Secret(bearer) && isLegacyPrivateKeyAuthAllowed(env)) {
    return { kind: 'private_key', privateKey: bearer };
  }

  return null;
}

function reply(
  res: ServerResponse | Http2ServerResponse,
  status: number,
  body: unknown,
): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function resolveInternalApiUrl(): string {
  if (process.env.SWARMDOCK_MCP_INTERNAL_URL) {
    return process.env.SWARMDOCK_MCP_INTERNAL_URL;
  }
  const port = process.env.PORT ?? '3100';
  return `http://127.0.0.1:${port}`;
}

export async function handleMcp(
  incoming: IncomingMessage | Http2ServerRequest,
  outgoing: ServerResponse | Http2ServerResponse,
): Promise<void> {
  try {
    // Liveness probe — useful for uptime pings that don't want to auth
    if (incoming.method === 'GET' && (incoming.url === '/mcp/healthz' || incoming.url === '/mcp')) {
      if (incoming.url === '/mcp/healthz') {
        reply(outgoing, 200, { ok: true, name: 'swarmdock-mcp', apiUrl: resolveInternalApiUrl() });
        return;
      }
    }

    const bearer = extractBearer(incoming);
    if (!bearer) {
      reply(outgoing, 401, {
        error: 'unauthorized',
        hint: 'Pass an Agent Authorization Token (AAT), or a base64 Ed25519 secret for legacy clients, as "Authorization: Bearer <credential>".',
      });
      return;
    }

    const auth = resolveMcpBearerAuth(bearer);
    if (!auth) {
      reply(outgoing, 401, {
        error: 'unauthorized',
        hint: 'Bearer credential must be a valid AAT JWT or base64 Ed25519 secret. Private-key bearer auth can be disabled with SWARMDOCK_MCP_ALLOW_PRIVATE_KEY_AUTH=0.',
      });
      return;
    }

    const { server, client } = createServer({
      config: {
        apiUrl: resolveInternalApiUrl(),
        privateKey: auth.kind === 'private_key' ? auth.privateKey : undefined,
      },
    });
    if (auth.kind === 'aat') {
      client.setToken(auth.token);
      (client as unknown as { agentId: string | null }).agentId = auth.agentId;
    }

    // Stateless mode — each POST is a complete MCP exchange. Tool calls are themselves
    // stateless (they go straight to the SwarmDock API), so we don't need session continuity.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    outgoing.on('close', () => {
      void transport.close().catch(() => undefined);
      void server.close().catch(() => undefined);
    });

    await server.connect(transport);
    await transport.handleRequest(incoming as IncomingMessage, outgoing as ServerResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`mcp handler failed: ${message}`, { error: message });
    if (!outgoing.headersSent) {
      reply(outgoing, 500, { error: 'internal_error', message });
    } else {
      outgoing.end();
    }
  }
}
