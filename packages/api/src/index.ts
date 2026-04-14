import { initTelemetry } from './lib/telemetry.js';
await initTelemetry();

import http from 'node:http';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { getRequestListener } from '@hono/node-server';
import { handleMcp } from './routes/mcp-http.js';
import agentRoutes from './routes/agents.js';
import taskRoutes from './routes/tasks.js';
import bidRoutes from './routes/bids.js';
import ratingRoutes from './routes/ratings.js';
import eventRoutes from './routes/events.js';
import paymentRoutes from './routes/payments.js';
import healthRoutes from './routes/health.js';
import adminRoutes from './routes/admin.js';
import artifactRoutes from './routes/artifacts.js';
import a2aRoutes from './routes/a2a.js';
import docsRoutes from './routes/docs.js';
import a2aRelayRoutes from './routes/a2a-relay.js';
import mcpRoutes from './routes/mcp.js';
import analyticsRoutes from './routes/analytics.js';
import qualityVerificationRoutes from './routes/quality-verification.js';
import socialRoutes from './routes/social.js';
import mcpMarketplaceRoutes from './routes/mcp-marketplace.js';
import { getAgentCardById } from './services/agent-card.js';
import { eventBus } from './lib/events.js';
import { rateLimitDefault } from './middleware/rateLimit.js';
import { otelMiddleware } from './middleware/otel.js';
import { validateChainConfig } from './services/escrow.js';
import { AppError } from './lib/errors.js';
import { createLogger } from './lib/logger.js';

const log = createLogger({ service: 'api' });

// INTENTIONAL: BigInt.prototype.toJSON monkey-patch.
// Drizzle ORM returns PostgreSQL bigint columns as native JS BigInt values,
// but JSON.stringify() throws "TypeError: Do not know how to serialize a BigInt"
// by default. This global patch converts BigInt to string during serialization
// so Hono's c.json() works transparently with USDC amounts (stored as bigint).
// This must run before any route handler is invoked.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

const app = new Hono();

// CORS — restrict origins in production
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:3200'];

app.use('*', cors({
  origin: corsOrigins,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Key'],
  maxAge: 86400,
}));
app.use('*', logger());
app.use('*', otelMiddleware);

// Reject request bodies larger than 50 MB
const MAX_BODY_BYTES = 50 * 1024 * 1024;
app.use('*', async (c, next) => {
  const contentLength = c.req.header('content-length');
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return c.json({ error: 'Request body too large' }, 413);
  }
  await next();
});

// Rate limiting
app.use('/api/*', rateLimitDefault);

// Global error handler — normalizes all errors to { error, code, details? }
app.onError((err, c) => {
  if (err instanceof AppError) {
    log.warn(`${c.req.method} ${c.req.path}: ${err.message}`, { code: err.code, status: err.status });
    return c.json({
      error: err.message,
      code: err.code,
      ...(err.details && { details: err.details }),
    }, err.status as 400);
  }

  const status = 'status' in err ? (err as { status: number }).status : 500;
  if (status >= 500) {
    log.error(`${c.req.method} ${c.req.path}: ${err.message}`, { status, error: err.message });
  }
  return c.json({
    error: status >= 500 ? 'Internal server error' : err.message,
    code: status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  }, status as 400);
});

// Routes
app.route('/api/v1/health', healthRoutes);
app.route('/api/v1/agents', agentRoutes);
app.route('/api/v1/tasks', taskRoutes);
app.route('/api/v1/tasks/:taskId/bids', bidRoutes);
app.route('/api/v1/ratings', ratingRoutes);
app.route('/api/v1/events', eventRoutes);
app.route('/api/v1/payments', paymentRoutes);
app.route('/api/v1/admin', adminRoutes);
app.route('/api/v1/artifacts', artifactRoutes);
app.route('/agents/:id/a2a', a2aRoutes);
app.route('/agents/:id/mcp', mcpRoutes);
app.route('/api/docs', docsRoutes);
app.route('/api/v1/a2a', a2aRelayRoutes);
app.route('/api/v1/analytics', analyticsRoutes);
app.route('/api/v1/quality', qualityVerificationRoutes);
app.route('/api/v1/social', socialRoutes);
app.route('/api/v1/mcp-marketplace', mcpMarketplaceRoutes);

app.get('/agents/:id/.well-known/agent.json', async (c) => {
  const agentCard = await getAgentCardById(c.req.param('id'));
  if (!agentCard) {
    return c.json({ error: 'Agent not found' }, 404);
  }

  return c.json(agentCard);
});

// Root
app.get('/', (c) =>
  c.json({
    name: 'SwarmDock API',
    version: '0.3.0',
    description: 'Peer-to-peer marketplace for autonomous AI agents',
    docs: '/api/v1/health',
  }),
);

const port = parseInt(process.env.PORT ?? '3100', 10);

// JWT secret production guard
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  log.error('FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}

// Chain configuration validation
validateChainConfig();

log.info(`SwarmDock API starting on port ${port}`);
void eventBus.startTransportBridge().catch((error) => {
  log.error('failed to start NATS transport bridge', { error: String(error) });
});

// Route /mcp to the MCP streamable-HTTP handler directly; everything else goes through Hono.
// MCP needs raw Node req/res to stream responses and handle session lifecycle correctly.
const honoListener = getRequestListener(app.fetch);
const server = http.createServer((req, res) => {
  const url = req.url ?? '';
  if (url === '/mcp' || url.startsWith('/mcp?') || url.startsWith('/mcp/')) {
    void handleMcp(req, res);
    return;
  }
  void honoListener(req, res);
});
server.listen(port);

// Graceful shutdown
function shutdown(signal: string) {
  log.info(`${signal} received, closing server...`);
  server.close((err?: Error) => {
    if (err) log.warn(`close error: ${err.message}`);
    log.info('Server closed');
    process.exit(0);
  });
  // Force exit after 10s if graceful close stalls
  setTimeout(() => { process.exit(1); }, 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
