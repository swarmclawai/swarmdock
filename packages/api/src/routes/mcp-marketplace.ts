import { Hono } from 'hono';
import { db } from '../db/client.js';
import { mcpServices, mcpToolCalls, mcpSubscriptions, agents } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { authMiddleware, requireScope, type AuthContext } from '../middleware/auth.js';
import { eventBus } from '../lib/events.js';
import {
  McpServiceCreateSchema,
  McpServiceUpdateSchema,
  McpToolCallSchema,
  McpServiceListQuerySchema,
} from '@swarmdock/shared';
import * as mcpMarketplaceService from '../services/mcp-marketplace.js';

type Database = typeof db;

export type McpMarketplaceDeps = {
  db: Database;
  authMiddleware: typeof authMiddleware;
  requireScope: typeof requireScope;
  eventBus: Pick<typeof eventBus, 'emit' | 'broadcast'>;
};

export function createMcpMarketplaceApp(overrides: Partial<McpMarketplaceDeps> = {}) {
  const database = overrides.db ?? db;
  const requireAuth = overrides.authMiddleware ?? authMiddleware;
  const withScope = overrides.requireScope ?? requireScope;
  const events = overrides.eventBus ?? eventBus;

  const app = new Hono<AuthContext>();

  // POST /services — Publish a new MCP service
  app.post('/services', requireAuth, withScope('mcp.write'), async (c) => {
    const body = await c.req.json();
    const parsed = McpServiceCreateSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const agent = c.get('agent');

    try {
      const service = await mcpMarketplaceService.publishService(
        agent.agent_id,
        {
          ...parsed.data,
          pricePerCall: parsed.data.pricePerCall != null ? BigInt(parsed.data.pricePerCall) : undefined,
          pricePerMinute: parsed.data.pricePerMinute != null ? BigInt(parsed.data.pricePerMinute) : undefined,
          subscriptionPrice: parsed.data.subscriptionPrice != null ? BigInt(parsed.data.subscriptionPrice) : undefined,
        },
        database,
      );

      events.broadcast({
        type: 'mcp.service.published',
        data: { serviceId: service.id, agentId: agent.agent_id, name: service.name },
      });

      return c.json(service, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to publish service';
      return c.json({ error: message }, 400);
    }
  });

  // GET /services — List/search MCP services (public)
  app.get('/services', async (c) => {
    const parsed = McpServiceListQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      return c.json({ error: 'Invalid query', details: parsed.error.flatten() }, 400);
    }

    const result = await mcpMarketplaceService.listServices(parsed.data, database);
    return c.json(result);
  });

  // GET /services/:id — Get service detail (public)
  app.get('/services/:id', async (c) => {
    const serviceId = c.req.param('id');
    const service = await mcpMarketplaceService.getService(serviceId, database);

    if (!service) {
      return c.json({ error: 'Service not found' }, 404);
    }

    return c.json(service);
  });

  // PATCH /services/:id — Update service (owner only)
  app.patch('/services/:id', requireAuth, withScope('mcp.write'), async (c) => {
    const serviceId = c.req.param('id');
    const body = await c.req.json();
    const parsed = McpServiceUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const agent = c.get('agent');

    try {
      const updates: Record<string, unknown> = { ...parsed.data };
      if (parsed.data.pricePerCall != null) {
        updates.pricePerCall = BigInt(parsed.data.pricePerCall);
      }
      if (parsed.data.subscriptionPrice != null) {
        updates.subscriptionPrice = BigInt(parsed.data.subscriptionPrice);
      }

      const updated = await mcpMarketplaceService.updateService(
        serviceId,
        agent.agent_id,
        updates,
        database,
      );
      return c.json(updated);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update service';
      const status = message === 'Service not found' ? 404
        : message === 'Not authorized to update this service' ? 403
        : 400;
      return c.json({ error: message }, status);
    }
  });

  // POST /services/:id/call — Invoke a tool on the MCP service
  app.post('/services/:id/call', requireAuth, withScope('mcp.write'), async (c) => {
    const serviceId = c.req.param('id');
    const body = await c.req.json();
    const parsed = McpToolCallSchema.safeParse(body);

    if (!parsed.success) {
      return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
    }

    const agent = c.get('agent');

    try {
      const result = await mcpMarketplaceService.invokeToolCall(
        serviceId,
        agent.agent_id,
        parsed.data.toolName,
        parsed.data.arguments,
        database,
      );
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Tool call failed';
      if (message === 'Service not found or inactive') {
        return c.json({ error: message }, 404);
      }
      if (message.includes('insufficient') || message.includes('balance')) {
        return c.json({ error: message }, 402);
      }
      return c.json({ error: message }, 500);
    }
  });

  // POST /services/:id/subscribe — Subscribe to a service
  app.post('/services/:id/subscribe', requireAuth, withScope('mcp.write'), async (c) => {
    const serviceId = c.req.param('id');
    const agent = c.get('agent');

    try {
      const subscription = await mcpMarketplaceService.subscribe(
        agent.agent_id,
        serviceId,
        database,
      );
      return c.json(subscription, 201);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to subscribe';
      if (message === 'Service is not subscription-based') {
        return c.json({ error: message }, 400);
      }
      if (message === 'Service not found') {
        return c.json({ error: message }, 404);
      }
      return c.json({ error: message }, 400);
    }
  });

  // DELETE /services/:id/subscribe — Cancel subscription
  app.delete('/services/:id/subscribe', requireAuth, withScope('mcp.write'), async (c) => {
    const serviceId = c.req.param('id');
    const agent = c.get('agent');

    try {
      await mcpMarketplaceService.cancelSubscription(
        agent.agent_id,
        serviceId,
        database,
      );
      return c.json({ message: 'Subscription cancelled' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to cancel subscription';
      return c.json({ error: message }, 404);
    }
  });

  // GET /services/:id/stats — Service analytics (owner only)
  app.get('/services/:id/stats', requireAuth, withScope('mcp.read'), async (c) => {
    const serviceId = c.req.param('id');
    const agent = c.get('agent');

    try {
      const stats = await mcpMarketplaceService.getServiceStats(
        serviceId,
        agent.agent_id,
        database,
      );
      return c.json(stats);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch stats';
      const status = message === 'Service not found' ? 404
        : message === 'Not authorized to view stats for this service' ? 403
        : 400;
      return c.json({ error: message }, status);
    }
  });

  return app;
}

export default createMcpMarketplaceApp();
