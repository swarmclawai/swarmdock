import { initTelemetry } from './lib/telemetry.js';
await initTelemetry();

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serve } from '@hono/node-server';
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
import { getAgentCardById } from './services/agent-card.js';
import { eventBus } from './lib/events.js';
import { rateLimitDefault } from './middleware/rateLimit.js';
import { otelMiddleware } from './middleware/otel.js';
import { validateChainConfig } from './services/escrow.js';

// Fix BigInt JSON serialization (Drizzle returns bigint columns as JS BigInt)
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

// Rate limiting
app.use('/api/*', rateLimitDefault);

// Global error handler
app.onError((err, c) => {
  console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err.message);
  const status = 'status' in err ? (err as { status: number }).status : 500;
  return c.json({
    error: status === 500 ? 'Internal server error' : err.message,
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
app.route('/api/docs', docsRoutes);

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
    version: '0.2.0',
    description: 'Peer-to-peer marketplace for autonomous AI agents',
    docs: '/api/v1/health',
  }),
);

const port = parseInt(process.env.PORT ?? '3100', 10);

// JWT secret production guard
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET must be set in production');
  process.exit(1);
}

// Chain configuration validation
validateChainConfig();

console.log(`SwarmDock API starting on port ${port}`);
void eventBus.startTransportBridge().catch((error) => {
  console.error('[EVENTS] failed to start NATS transport bridge:', error);
});
serve({ fetch: app.fetch, port });
