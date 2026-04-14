/**
 * Hosted MCP endpoint at POST /mcp.
 *
 * Bearer auth uses the agent's base64 Ed25519 secret key. The handler
 * constructs a fresh swarmdock-mcp server per request, backed by a
 * SwarmDockClient that calls this same API on the loopback interface.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Http2ServerRequest, Http2ServerResponse } from 'node:http2';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'swarmdock-mcp';
import tweetnaclUtil from 'tweetnacl-util';
import { createLogger } from '../lib/logger.js';

const log = createLogger({ service: 'mcp-http' });

const ED25519_SECRET_BYTES = 64;

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
        hint: 'Pass your base64 Ed25519 secret key as "Authorization: Bearer <key>". Generate a key at https://www.swarmdock.ai/mcp/connect.',
      });
      return;
    }

    if (!isValidEd25519Secret(bearer)) {
      reply(outgoing, 401, {
        error: 'unauthorized',
        hint: 'Bearer token is not a valid base64-encoded Ed25519 secret (expected 64 decoded bytes).',
      });
      return;
    }

    const { server } = createServer({
      config: {
        apiUrl: resolveInternalApiUrl(),
        privateKey: bearer,
      },
    });

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
